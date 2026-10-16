# Changelog

All notable changes to KOVR are documented here.

## Unreleased

### Evaluation
- Findings now persist fix-loop instrumentation: `fix_attempts` and
  `first_attempt_verified` (first-attempt vs. retry pass rates — RQ1)
- New `scripts/evaluate.py`: generates the research results report
  (RQ1 fix correctness, failure classes, RQ2 gate-vs-verifier split,
  RQ3 scan consistency) directly from the database

### Reliability
- Database connects with a 10-second timeout — a paused/unreachable
  database fails fast instead of hanging startup
- Schema init and scan-resume moved to a background thread: the web port
  opens immediately and a database outage can no longer wedge a deploy

### Operations
- Uptime monitoring on `/api/health` (external, multi-region, email alerts)

## v0.1.0 — 2026-10-15

First tagged release: AI security scanner with verified fixes and pull-request delivery.

### Core
- Four analyzers: security (Gitleaks + Semgrep), API design, backend logic, UI/UX
- Verified fix pipeline: investigate → patch → syntax gate → AI verification →
  failure-feedback retries with repeat-patch guard
- Codebase-wide findings split into per-file findings; umbrella scope restricted
  to high/critical severity
- Pull-request delivery: verified fixes committed to `kovr/fix-*` branch, single
  PR per scan under each user's own GitHub OAuth account
- Fix-branch archival (git bundles) — late pull requests survive working-copy cleanup
- Scan control: pause / resume / cancel, restart resume from disk-persisted progress,
  server-clocked elapsed timer, per-scan analyzer selection
- AI provider chain (Groq → OpenRouter → Gemini) with cooldown circuit-breakers,
  request timeouts, and last-successful preference
- Private-repository scanning via the user's connected GitHub token

### Accounts & security
- Argon2 + JWT httpOnly cookies (30-day sessions), rate-limited login/register/recovery
- Forgot / reset / change password; recovery email transport (Brevo HTTPS / SMTP)
  with on-screen temporary-password fallback when unconfigured
- Cross-browser scan history served from the database
- SSRF allowlist, weak-secret refusal, CORS explicit origins, per-user OAuth tokens

### Platform
- Monorepo (backend + frontend), CI on GitHub Actions (import check, pytest,
  typecheck, lint, build), auto-deploy to Render and Cloudflare Pages
- Docker image: Python 3.14, CPU-only torch, non-root, healthcheck, $PORT-aware
- Infrastructure as code: render.yaml; docker-compose for local full stack
- Restart resume, zero-DDL schema reconciliation at startup
