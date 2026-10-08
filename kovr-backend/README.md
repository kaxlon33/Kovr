# KOVR Backend

AI-powered security scanner. Paste a GitHub repository URL, and KOVR clones it, runs four
analyzers in parallel, generates verified code fixes for every finding, and opens a single
pull request under your own GitHub account.

## How it works

| Analyzer | What it does |
| --- | --- |
| **Security** | Gitleaks (secret detection) + Semgrep (vulnerability patterns) |
| **API Design** | HTTP methods, versioning, status codes, payload exposure (LLM) |
| **Backend Logic** | Business rules, data access, auth checks (LLM) |
| **UI/UX** | Frontend components, accessibility, state handling (LLM) |

Pipeline per finding: **investigate → patch (on a working copy) → verify (AI re-check +
Gitleaks re-scan) → commit** to a `kovr/fix-<scan>` branch → user presses **Open Pull
Request** → one PR listing every verified fix. Your original repository is never modified
directly.

AI calls walk a fallback chain — Groq → Groq (2nd model) → OpenRouter → Gemini — with
per-model cooldowns, request timeouts, and last-successful preference, so one dead provider
never stalls a scan. The chain can be reordered at runtime by an admin
(`GET/POST /api/settings/models`).

## Requirements

- Python 3.12+ (managed with [uv](https://docs.astral.sh/uv/))
- Docker (for Postgres + pgvector, or the full stack)
- Gitleaks is downloaded automatically in the Docker image; locally install it and ensure
  it is on PATH (`gitleaks version` → 8.30.x)

## Quick start (local dev)

```bash
# 1. Start Postgres with pgvector (Docker Desktop must be running)
docker compose up -d db

# 2. Configure environment
cp .env.example .env   # or create .env — see the table below

# 3. Install dependencies and run
uv sync
uv run uvicorn app.main:app --reload
```

The API serves at `http://127.0.0.1:8000` (health check: `GET /api/health`).
Database tables are created/migrated automatically at startup.

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection string (needs pgvector extension) |
| `JWT_SECRET` | yes in prod | 64-char hex — `python -c "import secrets; print(secrets.token_hex(32))"`; startup refuses weak secrets |
| `GROQ_API_KEY` | at least one AI provider | Primary model pool |
| `GEMINI_API_KEY` | — | Free-tier last-resort fallback (AI Studio key) |
| `OPENROUTER_API_KEY` | — | Additional fallback pool |
| `CORS_ORIGINS` | prod | Allowed frontend origins (comma-separated; `*` is rejected) |
| `APP_FRONTEND_URL` | — | Where OAuth redirects land after GitHub connect |
| `COOKIE_SECURE` | prod | `true` behind HTTPS |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | for PRs | GitHub OAuth app; callback `<backend-origin>/api/github/callback` |
| `GITHUB_TOKEN` | — | Server-wide fallback token for single-admin self-hosting |
| `HF_TOKEN` | — | Faster embedding model downloads on cold start |
| `LANGCHAIN_API_KEY` | — | LangSmith tracing |

## Full stack with Docker

```bash
# from this directory — builds the API image, starts Postgres + backend
docker compose up --build
```

Cloned repositories are kept in `./cloned_repos` (bind-mounted) and cleaned up
automatically: working copies stay while a scan has unfixed findings, expire 24h after
completion, and are hard-capped at 7 days.

## Deploy to Render

`render.yml` is a Render Blueprint — create a Blueprint deploy from this repo, fill in the
`sync: false` secrets in the dashboard, and attach a managed Postgres (with the `vector`
extension) for `DATABASE_URL`. Health check: `/api/health`.

## Project layout

```
app/
  main.py            FastAPI app, CORS, startup DB init
  core/
    ai_client.py     Provider chain, retry/cooldown, prompts, verification
    database.py      Models, scan orchestration, fix pipeline
    progress.py      In-memory scan progress + pause/cancel control
    scan_batching.py Batch scheduler for the LLM analyzers
    code_reader.py   Language-aware function extraction
    git_ops.py       Branch/commit operations on the working copy
    github_api.py    Push + pull requests via the user's OAuth token
    rate_limit.py    Login/registration rate limiting
    score.py         Security score
  routers/
    auth.py          Register/login (Argon2), JWT cookies
    clone.py         Scan lifecycle: clone → start → stream → results → cancel
    github_auth.py   Per-user GitHub OAuth connect/disconnect
    dev.py           Admin-only diagnostics + runtime model chain editor
  scanner/           The four analyzers
tests/               Pytest suite
requirements.txt     Pinned dependencies, exported from uv.lock
```

## Frontend

The matching SPA lives in `../kovr-frontend_new` (React + Vite + Tailwind). Set
`VITE_API_BASE` to the deployed backend URL when building it.

## Admin developer mode

Admins can enable **Developer mode** in Settings to inspect raw payloads, view runtime
provider state (chain, last successful model, active cooldowns), and edit the fallback
order live.
