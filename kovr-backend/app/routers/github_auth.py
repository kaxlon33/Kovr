"""
Per-user GitHub OAuth: every user connects their OWN GitHub account, so
the "Open Pull Request" flow pushes branches and opens PRs under each
user's identity — no shared server token, no cross-account access.

The instance owner registers one OAuth App (GITHUB_CLIENT_ID / _SECRET);
users only ever see an Authorize-GitHub screen for that app.
"""
import os
import secrets
import time
import urllib.parse
import urllib.request

from fastapi import APIRouter, Depends, Request
from fastapi.responses import RedirectResponse

from app.core.database import SessionLocal, User
from app.routers.auth import get_current_user

router = APIRouter()

# state -> (user_id, expires_at); CSRF protection for the OAuth round-trip.
_pending_states: dict[str, tuple[str, float]] = {}
STATE_TTL_SECONDS = 600


def _client_id() -> str:
    return os.getenv("GITHUB_CLIENT_ID", "").strip()


def _client_secret() -> str:
    return os.getenv("GITHUB_CLIENT_SECRET", "").strip()


def _frontend_url() -> str:
    return os.getenv("APP_FRONTEND_URL", "http://localhost:5180").rstrip("/")


def _callback_url(request: Request) -> str:
    """The OAuth callback registered with GitHub — this backend's origin."""
    if os.getenv("GITHUB_CALLBACK_URL"):
        return os.getenv("GITHUB_CALLBACK_URL").strip()
    return f"{request.url.scheme}://{request.url.netloc}/api/github/callback"


def github_configured() -> bool:
    return bool(_client_id() and _client_secret())


def user_github_token(user: User) -> str:
    """The user's own token; the server-wide GITHUB_TOKEN is only a
    fallback for self-hosted single-admin setups."""
    return (user.github_access_token or os.getenv("GITHUB_TOKEN", "").strip() or "").strip()


@router.get("/api/github/status")
def github_status(current_user: User = Depends(get_current_user)):
    return {
        "connected": bool(current_user.github_access_token),
        "oauth_configured": github_configured(),
    }


@router.get("/api/github/connect")
def github_connect(request: Request, current_user: User = Depends(get_current_user)):
    """Starts the OAuth dance: the browser is redirected to GitHub's
    authorize screen with a CSRF state bound to this user."""
    if not github_configured():
        return RedirectResponse(f"{_frontend_url()}/settings?github=not_configured")

    state = secrets.token_urlsafe(24)
    now = time.time()
    _pending_states[state] = (current_user.id, now + STATE_TTL_SECONDS)
    for key, (_, expires) in list(_pending_states.items()):
        if expires < now:
            _pending_states.pop(key, None)

    params = urllib.parse.urlencode(
        {
            "client_id": _client_id(),
            "redirect_uri": _callback_url(request),
            "scope": "repo",
            "state": state,
        }
    )
    return RedirectResponse(f"https://github.com/login/oauth/authorize?{params}")


@router.get("/api/github/callback")
def github_callback(code: str = "", state: str = "", error: str = ""):
    """GitHub redirects here after the user authorizes. Exchanges the code
    for a token, stores it on the account that started the flow, and sends
    the browser back to the frontend Settings page."""
    if error:
        return RedirectResponse(f"{_frontend_url()}/settings?github=denied")

    pending = _pending_states.pop(state, None)
    if not pending:
        return RedirectResponse(f"{_frontend_url()}/settings?github=state_expired")
    user_id, expires = pending
    if expires < time.time():
        return RedirectResponse(f"{_frontend_url()}/settings?github=state_expired")

    if not code:
        return RedirectResponse(f"{_frontend_url()}/settings?github=failed")

    data = urllib.parse.urlencode(
        {
            "client_id": _client_id(),
            "client_secret": _client_secret(),
            "code": code,
        }
    ).encode()
    req = urllib.request.Request(
        "https://github.com/login/oauth/access_token",
        data=data,
        headers={"Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        import json

        with urllib.request.urlopen(req) as response:
            payload = json.loads(response.read().decode())
    except Exception:
        return RedirectResponse(f"{_frontend_url()}/settings?github=failed")

    token = payload.get("access_token")
    if not token:
        return RedirectResponse(f"{_frontend_url()}/settings?github=failed")

    session = SessionLocal()
    user = session.query(User).filter(User.id == user_id).first()
    if not user:
        session.close()
        return RedirectResponse(f"{_frontend_url()}/settings?github=failed")
    user.github_access_token = token
    session.commit()
    session.close()
    return RedirectResponse(f"{_frontend_url()}/settings?github=connected")


@router.post("/api/github/disconnect")
def github_disconnect(current_user: User = Depends(get_current_user)):
    session = SessionLocal()
    user = session.query(User).filter(User.id == current_user.id).first()
    if user:
        user.github_access_token = None
        session.commit()
    session.close()
    return {"status": "disconnected"}
