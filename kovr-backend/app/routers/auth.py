"""
Auth endpoints and the two reusable dependencies (get_current_user,
require_admin) every protected router shares.

The JWT lives in an httpOnly, SameSite=Lax cookie — readable by no
JavaScript, sent on same-site navigation and top-level GETs, which is the
right default for a same-site API consumed by the bundled frontend.
"""
import os
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

router = APIRouter()

# Brute-force / spam guards: 10 login attempts per minute and 5
# registrations per hour per client IP.
login_limiter = rate_limit("login", max_hits=10, window_seconds=60)
register_limiter = rate_limit("register", max_hits=5, window_seconds=3600)

cookie_auth = APIKeyCookie(name=COOKIE_NAME, auto_error=False)


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    # Password policy lives at registration only — login must accept
    # whatever the stored hash can verify, including legacy passwords.
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


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
        samesite="lax",  # cookies never ride cross-site POSTs (CSRF)
        secure=secure,
        max_age=7 * 24 * 60 * 60,  # 7 days, matches token expiry
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
