import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import clone, dev, auth, github_auth
from app.core.database import init_db

app = FastAPI()


@app.on_event("startup")
def prepare_database():
    # Create missing tables AND reconcile columns the models gained since
    # the database was first created (create_all alone never alters
    # existing tables — that gap once left users.github_access_token
    # missing and every login returning 500).
    init_db()
    print("[db] schema reconciled")

    # Scans that were running when the process last died resume here —
    # only their unfinished pillars re-run; the rest close out cleanly.
    from app.routers.clone import resume_interrupted_scans

    resume_interrupted_scans()

default_origins = ["http://localhost:5173", "http://localhost:5180"]
env_origins = os.getenv("CORS_ORIGINS")
if env_origins:
    # Explicit origins only: "*" cannot be combined with allow_credentials
    # (browsers reject it), so a wildcard entry is dropped with a warning.
    requested = [orig.strip() for orig in env_origins.split(",")]
    if "*" in requested:
        print("WARNING: CORS_ORIGINS contains '*' — ignored. List the deployed "
              "frontend domains explicitly to keep cookie credentials working.")
    allowed_origins = [orig for orig in requested if orig and orig != "*"]
else:
    allowed_origins = default_origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(clone.router)
app.include_router(dev.router)
app.include_router(github_auth.router)
app.include_router(auth.router)

@app.get("/api/health")
def health():
    return {"status": "ok"}