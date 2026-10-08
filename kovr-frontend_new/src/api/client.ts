import type {
  CloneResult,
  DevInfo,
  FixResult,
  GithubStatus,
  Investigation,
  ModelChainEntry,
  ModelSettings,
  PrResult,
  PrStatus,
  ScanResults,
  User,
  VerifyResult,
} from '@/api/types'

/**
 * Backend base URL. Set VITE_API_BASE at build time for deployments
 * (e.g. Cloudflare Pages → your Render/API URL); falls back to local dev.
 * Developer mode can still override it at runtime (stored in localStorage).
 */
export const DEFAULT_API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000'

const API_BASE_KEY = 'kovr-api-base'

export function getApiBase(): string {
  try {
    return localStorage.getItem(API_BASE_KEY) || DEFAULT_API_BASE
  } catch {
    return DEFAULT_API_BASE
  }
}

export function setApiBase(value: string): void {
  try {
    const trimmed = value.trim()
    if (!trimmed || trimmed === DEFAULT_API_BASE) localStorage.removeItem(API_BASE_KEY)
    else localStorage.setItem(API_BASE_KEY, trimmed)
  } catch {
    /* storage unavailable — keep the default */
  }
}

/* ── Authentication ──────────────────────────────────────────────────── */

/**
 * Auth errors carry the backend's detail message ("Wrong email or
 * password") — surface it instead of a bare status code.
 */
async function throwAuthError(res: Response): Promise<never> {
  let message = `Request failed: ${res.status}`
  try {
    const body = await res.json()
    if (body?.detail) message = String(body.detail)
  } catch {
    /* non-JSON body — keep the status message */
  }
  throw new Error(message)
}

/* POST /api/auth/register { email, password } -> { user } */
export async function register(email: string, password: string): Promise<User> {
  const res = await fetch(`${getApiBase()}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) return throwAuthError(res)
  const data = await res.json()
  return data.user
}

/* POST /api/auth/login { email, password } -> { user } (sets session cookie) */
export async function login(email: string, password: string): Promise<User> {
  const res = await fetch(`${getApiBase()}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) return throwAuthError(res)
  const data = await res.json()
  return data.user
}

/* POST /api/auth/logout (clears the session cookie) */
export async function logout(): Promise<void> {
  await fetch(`${getApiBase()}/api/auth/logout`, {
    method: 'POST',
    credentials: 'include',
  })
}

/* GET /api/auth/me -> { user } — null when the session is gone. */
export async function getCurrentUser(): Promise<User | null> {
  const res = await fetch(`${getApiBase()}/api/auth/me`, { credentials: 'include' })
  if (res.status === 401 || res.status === 403) return null
  if (!res.ok) return throwAuthError(res)
  const data = await res.json()
  return data.user ?? null
}

/* POST /api/clone  { repo_url }  ->  { scan_id } */
export async function clone(repoUrl: string): Promise<CloneResult> {
  const res = await fetch(`${getApiBase()}/api/clone`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ repo_url: repoUrl }),
  })
  if (!res.ok) throw new Error(`Clone failed: ${res.status}`)
  return res.json()
}

/* POST /api/scan/{scan_id}/start?repo_url=...&pillars=... (pillars optional subset) */
export async function startScan(
  scanId: string,
  repoUrl: string,
  pillars: string[] = [],
): Promise<{ scan_id?: string; status?: string; error?: string }> {
  const params = new URLSearchParams({ repo_url: repoUrl })
  if (pillars.length > 0) params.set('pillars', pillars.join(','))
  const res = await fetch(`${getApiBase()}/api/scan/${scanId}/start?${params}`, {
    method: 'POST',
    credentials: 'include',
  })
  if (!res.ok) throw new Error(`Scan start failed: ${res.status}`)
  return res.json()
}

/* GET /api/scan/{scan_id}/stream  (Server-Sent Events) */
export function openScanStream(scanId: string): EventSource {
  // withCredentials is required cross-origin, otherwise the auth cookie
  // never reaches the SSE endpoint and the stream 401s.
  return new EventSource(`${getApiBase()}/api/scan/${scanId}/stream`, { withCredentials: true })
}

/* POST /api/scan/{scan_id}/cancel — cooperative abort at the next safe point */
export async function cancelScan(scanId: string): Promise<{ status?: string; error?: string }> {
  const res = await fetch(`${getApiBase()}/api/scan/${scanId}/cancel`, {
    method: 'POST',
    credentials: 'include',
  })
  if (!res.ok) throw new Error(`Cancel failed: ${res.status}`)
  const data = await res.json().catch(() => ({}) as { error?: string })
  if (data.error) throw new Error(data.error)
  return data
}

/* POST /api/scan/{scan_id}/pause | /resume */
export async function setScanPaused(scanId: string, paused: boolean): Promise<void> {
  const res = await fetch(`${getApiBase()}/api/scan/${scanId}/${paused ? 'pause' : 'resume'}`, {
    method: 'POST',
    credentials: 'include',
  })
  if (!res.ok) throw new Error(paused ? `Pause failed: ${res.status}` : `Resume failed: ${res.status}`)
  // Control endpoints report failures (e.g. unknown scan) with 200 + error.
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (data.error) throw new Error(data.error)
}

/* GET /api/scan/{scan_id}/results */
export async function fetchResults(scanId: string): Promise<ScanResults> {
  const res = await fetch(`${getApiBase()}/api/scan/${scanId}/results`, { credentials: 'include' })
  if (!res.ok) throw new Error(`Failed to fetch results: ${res.status}`)
  return res.json()
}

/* GET /api/finding/{id}/investigate — pass refresh=true to regenerate the AI fix */
export async function investigate(findingId: string, refresh = false): Promise<Investigation> {
  const query = refresh ? '?refresh=true' : ''
  const res = await fetch(`${getApiBase()}/api/finding/${findingId}/investigate${query}`, {
    credentials: 'include',
  })
  if (!res.ok) throw new Error(`Investigation failed: ${res.status}`)
  return res.json()
}

/* POST /api/finding/{id}/fix  { action: 'approve' | 'reject' } */
export async function applyFix(findingId: string, action: 'approve' | 'reject'): Promise<FixResult> {
  const res = await fetch(`${getApiBase()}/api/finding/${findingId}/fix`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ action }),
  })
  if (!res.ok) throw new Error(action === 'approve' ? `Fix failed: ${res.status}` : `Request failed: ${res.status}`)
  return res.json()
}

/* POST /api/finding/{id}/expand */
export async function expandFinding(findingId: string): Promise<{
  finding_id: string
  status: string
  new_finding_ids?: string[]
  error?: string
}> {
  const res = await fetch(`${getApiBase()}/api/finding/${findingId}/expand`, {
    method: 'POST',
    credentials: 'include',
  })
  if (!res.ok) throw new Error(`Expand failed: ${res.status}`)
  return res.json()
}

/* POST /api/finding/{id}/verify */
export async function verifyFix(findingId: string): Promise<VerifyResult> {
  const res = await fetch(`${getApiBase()}/api/finding/${findingId}/verify`, {
    method: 'POST',
    credentials: 'include',
  })
  if (!res.ok) throw new Error(`Verify failed: ${res.status}`)
  return res.json()
}

/* DELETE /api/scan/{id} — permanently remove a scan (findings + working copy) */
export async function deleteScan(scanId: string): Promise<void> {
  await fetch(`${getApiBase()}/api/scan/${scanId}`, {
    method: 'DELETE',
    credentials: 'include',
  })
}

/* GET /api/scan/{id}/pr — branch/commit/PR state for the PR lifecycle */
export async function fetchPrStatus(scanId: string): Promise<PrStatus> {
  const res = await fetch(`${getApiBase()}/api/scan/${scanId}/pr`, { credentials: 'include' })
  if (!res.ok) throw new Error(`PR status failed: ${res.status}`)
  return res.json()
}

/* POST /api/scan/{id}/pr — push the fix branch and open the pull request */
export async function openPullRequest(scanId: string): Promise<PrResult> {
  const res = await fetch(`${getApiBase()}/api/scan/${scanId}/pr`, {
    method: 'POST',
    credentials: 'include',
  })
  if (!res.ok) throw new Error(`Open PR failed: ${res.status}`)
  return res.json()
}

/* GET /api/github/status — is the current user's GitHub account connected */
export async function fetchGithubStatus(): Promise<GithubStatus> {
  const res = await fetch(`${getApiBase()}/api/github/status`, { credentials: 'include' })
  if (!res.ok) throw new Error(`GitHub status failed: ${res.status}`)
  return res.json()
}

/* POST /api/github/disconnect — drop the stored OAuth token */
export async function disconnectGithub(): Promise<void> {
  await fetch(`${getApiBase()}/api/github/disconnect`, { method: 'POST', credentials: 'include' })
}

/* GET /api/dev/info — runtime diagnostics for the developer panel */
export async function fetchDevInfo(): Promise<DevInfo> {
  const res = await fetch(`${getApiBase()}/api/dev/info`, { credentials: 'include' })
  if (!res.ok) throw new Error(`Dev info failed: ${res.status}`)
  return res.json()
}

/* GET /api/settings/models — current chain, defaults, known-good models */
export async function fetchModelSettings(): Promise<ModelSettings> {
  const res = await fetch(`${getApiBase()}/api/settings/models`, { credentials: 'include' })
  if (!res.ok) throw new Error(`Model settings failed: ${res.status}`)
  return res.json()
}

/* POST /api/settings/models — validate and install a new fallback chain */
export async function updateModelSettings(
  chain: ModelChainEntry[],
): Promise<{ status?: string; error?: string }> {
  const res = await fetch(`${getApiBase()}/api/settings/models`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ chain }),
  })
  if (!res.ok) throw new Error(`Model update failed: ${res.status}`)
  return res.json()
}

/**
 * The backend reports an exhausted AI quota as a plain message. Parsed exactly
 * as the original frontend did, so the wording stays compatible.
 */
export function parseRateLimitError(message: string) {
  const limitMatch = message.match(/Limit (\d+)/)
  const usedMatch = message.match(/Used (\d+)/)
  const requestedMatch = message.match(/Requested (\d+)/)
  const retryMatch = message.match(/try again in ([\dms.]+)/)

  if (limitMatch && usedMatch) {
    return {
      limit: limitMatch[1],
      used: usedMatch[1],
      requested: requestedMatch ? requestedMatch[1] : null,
      retryIn: retryMatch ? retryMatch[1] : null,
    }
  }
  return null
}
