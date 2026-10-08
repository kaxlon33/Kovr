/**
 * Backend contract — kept exactly as the KOVR backend delivers it.
 * These shapes were lifted verbatim from the supplied kovr-frontend App.tsx
 * and must not drift: the backend is the source of truth.
 */

export type PillarStatus = {
  status: string
  count?: number
  source?: string
  error?: string
}

export type ProgressState = {
  security?: PillarStatus
  api_design?: PillarStatus
  backend_logic?: PillarStatus
  ui_ux?: PillarStatus
  complete?: boolean
  /** Set when the scan is held at a safe point (Pause button). */
  paused?: boolean
  /** Set when the user cancelled the scan. */
  cancelled?: boolean
  /** Stream-level failure, e.g. the backend restarted mid-scan. */
  error?: string
}

export type Finding = {
  id: string
  pillar: string
  tool: string
  title: string
  file: string
  line: number | null
  severity: string
  description: string
  root_cause?: string | null
  impact?: string | null
 verified?: string
 scope?: string
 /** Why the last verification failed — explains regeneration + verdict. */
 last_verify_reason?: string | null
}

export type ScanResults = {
  scan_id: string
  repo_url: string
  score: number
  findings: Finding[]
}

export type Investigation = {
  id: string
  root_cause: string | null
  impact: string | null
  attack_path: string | null
  fix_explanation: string | null
  before_code: string
  after_code: string
  parse_error?: boolean
  /** Present when the backend refuses the investigation (e.g. AI quota). */
  error?: string
  /** Failure code the backend pairs with error: 'quota_exceeded' | 'investigation_failed'. */
  error_type?: string
  /** 'local' | 'codebase_wide' | 'redirect' — set when the finding scope is classified. */
  scope?: string
  /** Target file to patch, which can differ from finding.file if scope is redirect. */
  file?: string
}

export type FixResult = {
  status: 'fix_applied' | 'recorded' | 'failed' | 'codebase_wide' | string
  error?: string
}

export type VerifyResult = {
  verified: string
  reason?: string
}

export type CloneResult = {
  scan_id: string
}

/* ── Authentication (/api/auth/*) ────────────────────────────────── */

export type User = {
  id: string
  email: string
  /** 'user' | 'admin' — kept loose so unknown roles still render. */
  role: string
  created_at: string | null
}

/* ── Developer panel (GET /api/dev/info) ─────────────────────────── */

export type DevProvider = {
  priority: number
  label: string
  model: string
  sdk: string
}

export type DevLangSmith = {
  tracing_enabled: boolean
  project: string
  api_key_set: boolean
  endpoint: string
  dashboard_url: string
}

export type DevEnvKey = {
  set: boolean
  /** Only present for non-sensitive values (models, project, origins). */
  value?: string
}

export type DevInfo = {
  providers: DevProvider[]
  langsmith: DevLangSmith
  env: Record<string, DevEnvKey>
}

export type ModelChainEntry = {
  label: string
  model: string
}

export type ModelSettings = {
  chain: ModelChainEntry[]
  default_chain: ModelChainEntry[]
  available: Record<string, string[]>
  last_successful: { label: string | null; model: string | null }
}

/* ── Pull-request lifecycle ──────────────────────────────────────── */

export type PrStatus = {
  branch: string
  clone_available: boolean
  commit_count: number
  commit_messages: string[]
  pr_url: string | null
  token_configured: boolean
  error?: string
}

export type PrResult = {
  pr_url?: string
  already_open?: boolean
  error?: string
  findings?: { title: string; file: string; line?: number }[]
}

/* ── Per-user GitHub OAuth ───────────────────────────────────────── */

export type GithubStatus = {
  connected: boolean
  oauth_configured: boolean
}

/** Pillar keys as the backend names them, in display order. */
export const PILLAR_KEYS = ['security', 'api_design', 'backend_logic', 'ui_ux'] as const
export type PillarKey = (typeof PILLAR_KEYS)[number]

export const PILLAR_LABELS: Record<PillarKey, string> = {
  security: 'Security',
  api_design: 'API Design',
  backend_logic: 'Backend Logic',
  ui_ux: 'UI/UX',
}
