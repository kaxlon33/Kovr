# 🛡️ KOVR — AI Security Scanner

> **Scan it. Explain it. Fix it. Ship the pull request.**

[![FastAPI](https://img.shields.io/badge/backend-FastAPI-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/frontend-React_19-61dafb?logo=react&logoColor=white)](https://react.dev/)
[![Python](https://img.shields.io/badge/python-3.12+-3776ab?logo=python&logoColor=white)](https://www.python.org/)
[![TypeScript](https://img.shields.io/badge/typescript-strict-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Docker](https://img.shields.io/badge/docker-ready-2496ed?logo=docker&logoColor=white)](./kovr-backend/Dockerfile)

KOVR is an AI-powered security scanner built for the **"vibe coding"** era: AI writes code fast,
and security review becomes the bottleneck. Paste a GitHub repository URL and KOVR clones it,
analyzes it with **four specialized analyzers**, explains every issue in plain language,
**generates and verifies concrete code fixes**, and ships them as **one reviewable pull request**
under your own GitHub account.

---

## ✨ What it does

| | Analyzer | Checks for |
|---|---|---|
| 🔐 | **Security** | Leaked secrets (Gitleaks) + vulnerability patterns (Semgrep) |
| 🌐 | **API Design** | HTTP methods, versioning, status codes, payload exposure |
| ⚙️ | **Backend Logic** | Business rules, data access, auth checks, error handling |
| 🎨 | **UI/UX** | Frontend components, accessibility, state handling |

**The pipeline per finding:**

```
🔍 investigate  →  🩹 patch (on a working copy)  →  ✅ verify  →  📦 commit
     ↑__________________ failure reason fed back _________________|
```

- 🧠 **Self-correcting fixes** — every patch is re-verified; failures feed back into regeneration
  (bounded retries, deterministic syntax gate, repeat-patch guard)
- 👤 **Human-in-the-loop** — nothing touches your repository until *you* approve it
- 🔀 **Cross-file aware** — re-targets fixes to the right file, splits codebase-wide issues
  into individually fixable findings
- 📊 **Security score** that tracks remediation progress in real time
- 🐙 **One pull request** — all verified fixes combined on a `kovr/fix-*` branch, opened under
  **your** GitHub OAuth account (scan works on any public repo URL — no GitHub connection needed)

## 🏗️ Repository layout

```
Kovr/
├── kovr-backend/        🐍 FastAPI service — scanners, fix pipeline, AI chain, PR delivery
│   ├── app/core/        provider chain, verification, git ops, progress, rate limiting
│   ├── app/scanner/     the four analyzers
│   ├── app/routers/     auth, scan lifecycle, GitHub OAuth, admin diagnostics
│   └── tests/           pytest suite
├── kovr-frontend_new/   ⚛️ React 19 + Vite + Tailwind 4 SPA (dark cyan console theme)
└── render.yml           ☁️ Render blueprint (backend deploys straight from this repo)
```

## 🚀 Quickstart (local)

**Prerequisites:** Python 3.12+, [uv](https://docs.astral.sh/uv/), Node 18+, Docker (for Postgres).

```bash
# 1️⃣ Database (Postgres + pgvector)
cd kovr-backend
docker compose up -d db

# 2️⃣ Backend — configure secrets, install, run
cp .env.example .env          # then fill in keys (see table below)
uv sync
uv run uvicorn app.main:app --reload   # → http://127.0.0.1:8000

# 3️⃣ Frontend
cd ../kovr-frontend_new
npm install
npm run dev                   # → http://localhost:5180
```

Or run the **whole stack** in Docker: `docker compose up --build` from `kovr-backend/`.

## 🔐 Environment variables (backend `.env`)

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | ✅ | Postgres connection string (needs pgvector) |
| `JWT_SECRET` | ✅ prod | 64-char hex — weak secrets are refused at startup |
| `GROQ_API_KEY` | 🤖 | Primary AI provider (at least one provider required) |
| `GEMINI_API_KEY` | 🤖 | Free-tier last-resort fallback |
| `OPENROUTER_API_KEY` | 🤖 | Additional fallback pool |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | 🐙 | OAuth app for PR delivery |
| `CORS_ORIGINS` | ✅ prod | Allowed frontend origins (no wildcards) |

Full table: [`kovr-backend/README.md`](./kovr-backend/README.md)

## 🤖 AI resilience

AI calls walk a **fallback chain** — Groq → OpenRouter → Gemini — with per-model
**cooldown circuit breakers**, request timeouts, and last-successful preference.
A rate-limited or dead provider slows nothing down; scans pause/resume/cancel
cooperatively and even **resume after a backend restart**.

## 🧪 Testing & quality

```bash
cd kovr-backend  && uv run pytest -q      # backend suite
cd kovr-frontend_new && npx tsc -b --noEmit && npm run lint
```

## ☁️ Deployment

- **Backend:** `render.yml` is a Render Blueprint — create a Blueprint deploy from this repo,
  fill the `sync: false` secrets, attach a Postgres (pgvector) for `DATABASE_URL`.
- **Frontend:** build with `VITE_API_BASE` pointing at the deployed backend
  (Cloudflare Pages / Netlify / any static host).

## 🧭 Philosophy

> AI finds and drafts; **verification proves**; **humans decide**. KOVR never pushes
> anything you haven't approved, and never claims a fix works without re-checking it.

---

<p align="center">Built with 🛠️ FastAPI · React · Tailwind · Groq · OpenRouter · Gemini</p>
