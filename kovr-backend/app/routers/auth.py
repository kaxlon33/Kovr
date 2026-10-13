"""
Auth endpoints and the two reusable dependencies (get_current_user,
require_admin) every protected router shares.

The JWT lives in an httpOnly, SameSite=Lax cookie — readable by no
JavaScript, sent on same-site navigation and top-level GETs, which is the
right default for a same-site API consumed by the bundled frontend.
"""
import os
import secrets
import uuid as uuid_lib

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.security import APIKeyCookie
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from app.core.auth import (
    COOKIE_NAME,
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)
from app.core.database import SessionLocal, User
from app.core.rate_limit import rate_limit
from app.core.mailer import send_temp_password_email, smtp_configured

router = APIRouter()

# Brute-force / spam guards: 10 login attempts per minute and 5
# registrations per hour per client IP.
login_limiter = rate_limit("login", max_hits=10, window_seconds=60)
register_limiter = rate_limit("register", max_hits=5, window_seconds=3600)
forgot_limiter = rate_limit("forgot", max_hits=5, window_seconds=3600)

cookie_auth = APIKeyCookie(name=COOKIE_NAME, auto_error=False)


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    # Password policy lives at registration only — login must accept
    # whatever the stored hash can verify, including legacy passwords.
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    email: EmailStr
    temp_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _user_response(user: User) -> dict:
    # Only ever id/email/role/created_at — never the hashed password.
    return {
        "id": user.id,
        "email": user.email,
        "role": user.role,
        "created_at": user.created_at.isoformat() if user.created_at else None,
    }


def get_current_user(
    token: str | None = Depends(cookie_auth), db: Session = Depends(get_db)
) -> User:
    user_id = decode_access_token(token) if token else None
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    return user


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return current_user


def _set_auth_cookie(response: Response, token: str) -> None:
    # COOKIE_SECURE=false keeps local http://localhost logins working; set
    # COOKIE_SECURE=true in the deployment environment (HTTPS) so the
    # session cookie is never sent over plain HTTP.
    secure = os.getenv("COOKIE_SECURE", "false").lower() in ("1", "true", "yes")
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        # Deployed frontend (pages.dev) and backend (onrender.com) are
        # DIFFERENT sites: only SameSite=None cookies ride cross-site
        # requests. Localhost keeps Lax — stronger CSRF protection
        # wherever the same-site guarantee exists.
        samesite="none" if secure else "lax",
        secure=secure,
        max_age=30 * 24 * 60 * 60,  # 30 days, matches token expiry
        path="/",
    )


@router.post("/api/auth/register")
def register(
    request: RegisterRequest,
    db: Session = Depends(get_db),
    _limited: None = Depends(register_limiter),
):
    email = request.email.lower().strip()
    existing = db.query(User).filter(User.email == email).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists",
        )

    user = User(
        id=str(uuid_lib.uuid4()),
        email=email,
        hashed_password=hash_password(request.password),
        role="user",
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    return {"status": "registered", "user": _user_response(user)}


@router.post("/api/auth/login")
def login(
    request: LoginRequest,
    response: Response,
    db: Session = Depends(get_db),
    _limited: None = Depends(login_limiter),
):
    email = request.email.lower().strip()
    user = db.query(User).filter(User.email == email).first()

    # Same message either way — never reveal whether the email exists.
    if not user or not verify_password(request.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Wrong email or password",
        )

    token = create_access_token(user.id)
    _set_auth_cookie(response, token)
    return {"status": "logged_in", "user": _user_response(user)}


@router.post("/api/auth/logout")
def logout(response: Response):
    response.delete_cookie(key=COOKIE_NAME, path="/")
    return {"status": "logged_out"}


@router.get("/api/auth/me")
def me(current_user: User = Depends(get_current_user)):
    return {"user": _user_response(current_user)}


@router.post("/api/auth/forgot-password")
def forgot_password(
    request: ForgotPasswordRequest,
    db: Session = Depends(get_db),
    _limited: None = Depends(forgot_limiter),
):
    email = request.email.lower().strip()
    user = db.query(User).filter(User.email == email).first()
    if not user:
        # Identical response shape whether or not the account exists.
        return {"status": "sent"}

    temp_password = secrets.token_urlsafe(9)
    user.hashed_password = hash_password(temp_password)
    db.commit()

    if smtp_configured():
        try:
            send_temp_password_email(user.email, temp_password)
            return {"status": "sent"}
        except Exception as e:
            import smtplib

            print(f"[mail] failed to send recovery email to {email[:3]}***: {type(e).__name__}: {e}")
            if isinstance(e, smtplib.SMTPAuthenticationError):
                reason = "The email provider rejected the username/password — check SMTP_USER/SMTP_PASSWORD."
            elif isinstance(e, (TimeoutError, ConnectionError, OSError)):
                reason = (
                    "The server cannot reach the email provider — SMTP ports are blocked "
                    "on this host (Render free blocks 25/465/587). Use an email API (BREVO_API_KEY) instead."
                )
            else:
                reason = f"{type(e).__name__}"
            return {"error": f"Email delivery failed: {reason}"}

    # No email transport configured — self-service demo mode: the
    # temporary password is returned to the screen instead of an inbox.
    # (Production instances configure SMTP or BREVO_API_KEY.)
    return {"status": "sent", "temp_password": temp_password}


@router.post("/api/auth/reset-password")
def reset_password(request: ResetPasswordRequest, db: Session = Depends(get_db)):
    email = request.email.lower().strip()
    user = db.query(User).filter(User.email == email).first()
    if not user or not verify_password(request.temp_password, user.hashed_password):
        return {"error": "Temporary password is not valid for this email. Request a new one."}
    user.hashed_password = hash_password(request.new_password)
    db.commit()
    return {"status": "changed"}


@router.post("/api/auth/change-password")
def change_password(
    request: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not verify_password(request.current_password, current_user.hashed_password):
        return {"error": "Current password is incorrect."}
    current_user.hashed_password = hash_password(request.new_password)
    db.commit()
    return {"status": "changed"}
