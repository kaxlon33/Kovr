"""
Authentication primitives: Argon2id password hashing and JWT creation /
decoding. Cookie policy lives in app/routers/auth.py.
"""
import os
import uuid as uuid_lib
from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt
from passlib.context import CryptContext

# Argon2id is the primary (and only) scheme — no legacy hashes to support.
pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")

ALGORITHM = "HS256"
TOKEN_EXPIRE_DAYS = 7
COOKIE_NAME = "kovr_session"


_ephemeral_secret: str | None = None


def _get_secret() -> str:
    global _ephemeral_secret
    secret = os.getenv("JWT_SECRET")
    if secret:
        # A short or placeholder secret is a real vulnerability in
        # production — refuse to run silently with one.
        weak_values = {"changeme", "secret", "test", "dev", "placeholder"}
        if secret.lower() in weak_values or len(secret) < 32:
            raise RuntimeError(
                "JWT_SECRET is too weak — generate one with: "
                'python -c "import secrets; print(secrets.token_hex(32))"'
            )
        return secret
    # Dev fallback, generated once per process so tokens stay valid until
    # restart. Set JWT_SECRET to keep sessions across restarts.
    if _ephemeral_secret is None:
        import secrets

        _ephemeral_secret = secrets.token_urlsafe(48)
        print("WARNING: JWT_SECRET not set — generated an ephemeral secret. "
              "Set JWT_SECRET in the environment to keep sessions across restarts.")
    return _ephemeral_secret


# Resolved lazily per call so tests / runtime can set JWT_SECRET after import.
def create_access_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "exp": datetime.now(timezone.utc) + timedelta(days=TOKEN_EXPIRE_DAYS),
        "iat": datetime.now(timezone.utc),
        "jti": uuid_lib.uuid4().hex,
    }
    return jwt.encode(payload, _get_secret(), algorithm=ALGORITHM)


def decode_access_token(token: str) -> str | None:
    """Returns the user id on a valid, unexpired token; None otherwise."""
    try:
        payload = jwt.decode(token, _get_secret(), algorithms=[ALGORITHM])
    except JWTError:
        return None
    user_id = payload.get("sub")
    return user_id if isinstance(user_id, str) else None


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return pwd_context.verify(plain_password, hashed_password)
    except Exception:
        return False
