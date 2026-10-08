# KOVR — AI Security Scanner (frontend)

React 19 + Vite + TypeScript SPA for the KOVR backend, styled with Tailwind CSS 4 in a
dark cyan "console" theme (Geist / Geist Mono).

Paste a GitHub repository URL, choose which analyzers to run, watch the live scan, then
review AI-generated fixes — each one verified before it is offered — and ship them as a
single pull request under your own GitHub account.

## Run

```bash
npm install
npm run dev        # http://localhost:5180
```

The backend must be running (default expected at `http://localhost:8000` — see
[`../kovr-backend`](../kovr-backend)). To point at a different backend, set:

```
VITE_API_BASE=https://your-backend.example.com
```

in a `.env` file here (see `.env.example`). The value is baked in at build time — set it
in your deploy environment (e.g. Cloudflare Pages) for production.

Auth uses the backend's JWT cookie, so the backend must list this origin in its
`CORS_ORIGINS`.

## Screens

| Route | Screen |
| --- | --- |
| `/login` · `/register` | Account creation and sign-in (Argon2 + JWT cookie) |
| `/connect` | Landing page — paste a repo URL, recent scans, pipeline overview |
| `/scan-setup` | Choose which of the four analyzers to run (languages auto-detected) |
| `/scan` | Live pillar progress (SSE) with Pause / Resume / Cancel |
| `/report` | Score, severity breakdown, findings list, bulk approve, PR lifecycle |
| `/findings/:id` | Root cause, impact, suggested patch, approve/reject |
| `/findings/:id/verified` | Verification result and score delta |
| `/summary` | Executive summary and report download |
| `/history` | Scan history (per-account, stored locally + on the server) |
| `/settings` | Account, GitHub connection, interface preferences |
| `/docs` | In-app guide |

## Features

- Four analyzers (Security / API Design / Backend Logic / UI/UX) with per-scan selection
- Live SSE progress, pause/resume/cancel of running scans
- Verified fix pipeline: investigate → patch → re-check → commit → one pull request
- Per-user GitHub OAuth (PRs open under each user's own account)
- Per-account browser storage with cross-tab sync
- Command palette (`Ctrl K`), keyboard navigation (`j`/`k`/`x`, `g` then a letter)
- Search, severity filter, sort, bulk approve with pause
- Markdown / JSON / CSV / PDF export, desktop notifications
- Admin developer mode: raw payloads, runtime AI provider chain editor
- Reduced-motion support, responsive layout

## Layout

```
src/
  api/client.ts        every network call — the only file with a URL
  api/types.ts         backend response shapes
  store/useScanStore.ts  the flows: what to call, in what order, what to do with answers
  store/useAuthStore.ts  session, admin check, per-account storage adoption
  lib/                 formatting, severity mapping, per-user storage, notifications
  components/
    ui/                buttons, modals, toasts, primitives
    layout/            app shell, side nav, top bar, banners, panels
    findings/          finding rows and detail pieces
    viz/               score rings, charts
  pages/               one file per screen
```

## Scripts

```bash
npm run dev             # dev server on 5180
npm run build           # typecheck + production build
npm run preview         # serve the built app on 5181
npm run lint            # oxlint
npx tsc -b --noEmit     # typecheck only
```
