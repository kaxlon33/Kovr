import os
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.core.ai_client import (
    PROVIDER_CHAIN,
    KNOWN_MODELS,
    get_provider_chain,
    get_last_successful,
    get_active_cooldowns,
    set_provider_chain,
    groq_client,
    openrouter_client,
    gemini_client,
)
from app.core.database import User
from app.routers.auth import require_admin

router = APIRouter()

CLIENTS = {"groq": groq_client, "openrouter": openrouter_client, "gemini": gemini_client}

# Keys surfaced in the developer panel. Non-sensitive configuration (models,
# project names, origins) is shown raw; anything secret-like is reported as
# set/not-set ONLY — never a raw or masked fragment, since even a fragment
# can leak information.
TRACKED_ENV_KEYS = [
    "GROQ_API_KEY",
    "GROQ_MODEL",
    "GROQ_FALLBACK_MODEL",
    "OPENROUTER_API_KEY",
    "OPENROUTER_MODEL",
    "GEMINI_API_KEY",
    "GEMINI_MODEL",
    "GITHUB_TOKEN",
    "GITHUB_CLIENT_ID",
    "GITHUB_CLIENT_SECRET",
    "LANGCHAIN_API_KEY",
    "LANGCHAIN_TRACING_V2",
    "LANGCHAIN_PROJECT",
    "DATABASE_URL",
    "CORS_ORIGINS",
]

SECRET_MARKERS = ("KEY", "SECRET", "PASSWORD", "TOKEN")


def _is_secret(key: str) -> bool:
    return any(marker in key for marker in SECRET_MARKERS) or key == "DATABASE_URL"


@router.get("/api/dev/info")
def dev_info(_admin: User = Depends(require_admin)):
    """Runtime diagnostics for the frontend developer panel.

    Secrets (API keys, database URLs with embedded credentials) are never
    returned — not even masked. Only whether they are set.
    """
    providers = [
        {
            "priority": priority,
            "label": label,
            "model": model,
            "sdk": type(client).__module__.split(".")[0],
        }
        for priority, (client, model, label) in enumerate(get_provider_chain(), start=1)
    ]

    endpoint = os.getenv("LANGCHAIN_ENDPOINT", "https://smith.langchain.com")
    # Link to the general dashboard rather than constructing an org-scoped
    # URL — the org id is not in the environment and should not be hardcoded
    # into the frontend. The project name is shown beside the link instead.
    langsmith = {
        "tracing_enabled": os.getenv("LANGCHAIN_TRACING_V2", "").lower() in ("1", "true", "yes"),
        "project": os.getenv("LANGCHAIN_PROJECT", "default"),
        "api_key_set": bool(os.getenv("LANGCHAIN_API_KEY")),
        "endpoint": endpoint,
        "dashboard_url": f"{endpoint.rstrip('/')}/projects",
    }

    env = {}
    for key in TRACKED_ENV_KEYS:
        value = os.getenv(key)
        if value is None or value == "":
            env[key] = {"set": False}
        elif _is_secret(key):
            env[key] = {"set": True}
        else:
            env[key] = {"set": True, "value": value}

    return {"providers": providers, "langsmith": langsmith, "env": env}


# ── Runtime model chain configuration ─────────────────────────────────────


class ChainEntry(BaseModel):
    label: str
    model: str


class ModelChainUpdate(BaseModel):
    chain: list[ChainEntry]


MAX_CHAIN_LENGTH = 5


@router.get("/api/settings/models")
def get_model_settings(_admin: User = Depends(require_admin)):
    """Current runtime chain, the .env defaults (for Reset), the
    known-good model list per provider, and which pair served the last
    successful request."""
    return {
        "chain": [{"label": label, "model": model} for (_c, model, label) in get_provider_chain()],
        "default_chain": [
            {"label": label, "model": model} for (_c, model, label) in PROVIDER_CHAIN
        ],
        "available": KNOWN_MODELS,
        "last_successful": get_last_successful(),
        "cooldowns": get_active_cooldowns(),
    }


@router.post("/api/settings/models")
def update_model_settings(update: ModelChainUpdate, _admin: User = Depends(require_admin)):
    """Reorder/edit the fallback chain. Validation is strict on purpose:
    no empty chains, no duplicates, and only known-good model slugs — a
    typo'd slug reproduces the silent-404 cycle, not a useful error."""
    if not 1 <= len(update.chain) <= MAX_CHAIN_LENGTH:
        return {"error": f"Chain must have between 1 and {MAX_CHAIN_LENGTH} entries"}

    seen = set()
    for entry in update.chain:
        if entry.label not in KNOWN_MODELS:
            return {"error": f"Unknown provider '{entry.label}' (use groq, openrouter or gemini)"}
        if entry.label == "gemini" and gemini_client is None:
            return {"error": "Gemini is not configured — set GEMINI_API_KEY on the backend first"}
        if entry.model not in KNOWN_MODELS[entry.label]:
            return {"error": f"'{entry.model}' is not a known-good {entry.label} model"}
        key = (entry.label, entry.model)
        if key in seen:
            return {"error": f"Duplicate chain entry: {entry.label}/{entry.model}"}
        seen.add(key)

    set_provider_chain([(CLIENTS[entry.label], entry.model, entry.label) for entry in update.chain])

    return {
        "status": "updated",
        "chain": [{"label": entry.label, "model": entry.model} for entry in update.chain],
    }
