import type { Finding } from '@/api/types'

/* ── Severity ────────────────────────────────────────────────────────
   The backend emits any of: critical, high, error, medium, warning, low,
   info. The grouping below matches the original frontend's bulk-select
   buckets exactly; only the palette is ours.
   ─────────────────────────────────────────────────────────────────── */

export type SeverityKey = 'critical' | 'high' | 'error' | 'medium' | 'warning' | 'low' | 'info' | 'unknown'

/** The three buckets the bulk-select buttons act on, verbatim from the backend contract. */
export const SEVERITY_BUCKETS = {
  highCritical: ['high', 'critical', 'error'],
  warnings: ['medium', 'warning'],
  info: ['low', 'info'],
} as const

export const SEVERITY_META: Record<
  SeverityKey,
  {
    label: string
    text: string
    bg: string
    border: string
    borderActive: string
    dot: string
    ring: string
    hex: string
    /** Sort weight — lower sorts first. */
    order: number
  }
> = {
  critical: {
    label: 'Critical',
    text: 'text-sev-critical',
    bg: 'bg-sev-critical/10',
    border: 'border-sev-critical/25',
    borderActive: 'border-sev-critical/60',
    dot: 'bg-sev-critical',
    ring: 'hover:border-sev-critical/50',
    hex: '#ef4444',
    order: 0,
  },
  error: {
    label: 'Error',
    text: 'text-sev-critical',
    bg: 'bg-sev-critical/10',
    border: 'border-sev-critical/25',
    borderActive: 'border-sev-critical/60',
    dot: 'bg-sev-critical',
    ring: 'hover:border-sev-critical/50',
    hex: '#ef4444',
    order: 1,
  },
  high: {
    label: 'High',
    text: 'text-sev-high',
    bg: 'bg-sev-high/10',
    border: 'border-sev-high/25',
    borderActive: 'border-sev-high/60',
    dot: 'bg-sev-high',
    ring: 'hover:border-sev-high/50',
    hex: '#f97316',
    order: 2,
  },
  medium: {
    label: 'Medium',
    text: 'text-sev-medium',
    bg: 'bg-sev-medium/10',
    border: 'border-sev-medium/25',
    borderActive: 'border-sev-medium/60',
    dot: 'bg-sev-medium',
    ring: 'hover:border-sev-medium/50',
    hex: '#eab308',
    order: 3,
  },
  warning: {
    label: 'Warning',
    text: 'text-sev-medium',
    bg: 'bg-sev-medium/10',
    border: 'border-sev-medium/25',
    borderActive: 'border-sev-medium/60',
    dot: 'bg-sev-medium',
    ring: 'hover:border-sev-medium/50',
    hex: '#eab308',
    order: 4,
  },
  low: {
    label: 'Low',
    text: 'text-sev-low',
    bg: 'bg-sev-low/10',
    border: 'border-sev-low/25',
    borderActive: 'border-sev-low/60',
    dot: 'bg-sev-low',
    ring: 'hover:border-sev-low/50',
    hex: '#71717a',
    order: 5,
  },
  info: {
    label: 'Info',
    text: 'text-sev-info',
    bg: 'bg-sev-info/10',
    border: 'border-sev-info/25',
    borderActive: 'border-sev-info/60',
    dot: 'bg-sev-info',
    ring: 'hover:border-sev-info/50',
    hex: '#38bdf8',
    order: 6,
  },
  unknown: {
    label: 'Unknown',
    text: 'text-on-surface-variant',
    bg: 'bg-surface-container-highest',
    border: 'border-outline-variant',
    borderActive: 'border-outline',
    dot: 'bg-outline',
    ring: 'hover:border-outline',
    hex: '#52525b',
    order: 7,
  },
}

export function severityKey(severity: string | undefined | null): SeverityKey {
  const key = severity?.toLowerCase() as SeverityKey | undefined
  return key && key in SEVERITY_META ? key : 'unknown'
}

export function severityMeta(severity: string | undefined | null) {
  return SEVERITY_META[severityKey(severity)]
}

/** Counts per bulk-select bucket, used by the report's summary cards. */
export function bucketCounts(findings: Finding[]) {
  const counts = { highCritical: 0, warnings: 0, info: 0, other: 0 }
  for (const finding of findings) {
    const key = severityKey(finding.severity)
    if ((SEVERITY_BUCKETS.highCritical as readonly string[]).includes(key)) counts.highCritical += 1
    else if ((SEVERITY_BUCKETS.warnings as readonly string[]).includes(key)) counts.warnings += 1
    else if ((SEVERITY_BUCKETS.info as readonly string[]).includes(key)) counts.info += 1
    else counts.other += 1
  }
  return counts
}

/** Per-severity tally for the distribution bar. */
export function severityCounts(findings: Finding[]): Record<SeverityKey, number> {
  const counts = {
    critical: 0,
    error: 0,
    high: 0,
    medium: 0,
    warning: 0,
    low: 0,
    info: 0,
    unknown: 0,
  } as Record<SeverityKey, number>
  for (const finding of findings) counts[severityKey(finding.severity)] += 1
  return counts
}

/* ── Score ───────────────────────────────────────────────────────── */

export function grade(score: number): string {
  if (score >= 95) return 'A+'
  if (score >= 85) return 'A'
  if (score >= 75) return 'B'
  if (score >= 65) return 'C'
  if (score >= 50) return 'D'
  return 'F'
}

export function scoreHex(score: number): string {
  if (score >= 85) return '#34d399'
  if (score >= 65) return '#eab308'
  if (score >= 50) return '#f97316'
  return '#ef4444'
}

export function scoreTone(score: number): string {
  if (score >= 85) return 'text-tertiary'
  if (score >= 65) return 'text-sev-medium'
  if (score >= 50) return 'text-sev-high'
  return 'text-error'
}

export function scoreVerdict(score: number): string {
  if (score >= 95) return 'Hardened'
  if (score >= 85) return 'Healthy'
  if (score >= 65) return 'Needs Improvement'
  if (score >= 50) return 'At Risk'
  return 'Critical Exposure'
}

/* ── Paths, repos, time ──────────────────────────────────────────── */

/** Strip the server-side clone directory, exactly as the original UI did. */
export function cleanPath(file: string): string {
  return file.replace(/^cloned_repos\/[^/\\]+[/\\]?/, '')
}

export function findingLocation(finding: Finding): string {
  return `${cleanPath(finding.file)}${finding.line ? `:${finding.line}` : ''}`
}

export function repoLabel(repoUrl: string): string {
  return repoUrl.replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/\.git$/, '') || repoUrl
}

/**
 * The internal AI analyzer id is never shown to users — which model served a
 * finding is an implementation detail. Real scanners (gitleaks, semgrep) keep
 * their name; AI findings report no tool.
 */
export function displayTool(tool: string | undefined | null): string {
  return tool && tool !== 'groq_ai' ? tool : ''
}

/**
 * Turn an internal verification failure reason into one calm sentence a
 * regular user can act on. Retry counts, pipeline stages and AI internals
 * never surface here — developers see the raw reason in developer mode.
 */
export function friendlyVerifyReason(reason: string | undefined | null): string {
  const r = (reason ?? '').toLowerCase()
  if (!r) return 'We could not confirm this fix resolves the issue.'
  if (r.includes('identical to a previous failed attempt'))
    return 'The same fix was suggested again, so retrying will not improve it — this one needs your judgment.'
  if (r.includes('fails to compile') || r.includes('syntax'))
    return 'The suggested change would break the file, so it was not kept.'
  if (r.includes('still detected') || r.includes('still present') || r.includes('not resolved'))
    return 'The issue still appears in the updated code.'
  if (r.includes('quota') || r.includes('limit'))
    return 'The AI limit was reached before verification could finish — try again later.'
  if (r.includes('secret'))
    return 'The changed code would introduce a secret, so it was blocked.'
  return 'We could not confirm this fix resolves the issue.'
}

const RTF = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
const DIVISIONS: { amount: number; unit: Intl.RelativeTimeFormatUnit }[] = [
  { amount: 60, unit: 'second' },
  { amount: 60, unit: 'minute' },
  { amount: 24, unit: 'hour' },
  { amount: 7, unit: 'day' },
  { amount: 4.34524, unit: 'week' },
  { amount: 12, unit: 'month' },
  { amount: Number.POSITIVE_INFINITY, unit: 'year' },
]

export function relativeTime(iso: string): string {
  let duration = (new Date(iso).getTime() - Date.now()) / 1000
  for (const division of DIVISIONS) {
    if (Math.abs(duration) < division.amount) return RTF.format(Math.round(duration), division.unit)
    duration /= division.amount
  }
  return iso
}

export function absoluteTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

/* ── Bulk pipeline labels ────────────────────────────────────────── */

export const BULK_STATUS_META: Record<string, { label: string; className: string }> = {
  pending: { label: 'Queued', className: 'text-on-surface-variant' },
  investigating: { label: 'Investigating…', className: 'text-primary' },
  fixing: { label: 'Applying fix…', className: 'text-primary' },
  verifying: { label: 'Verifying…', className: 'text-primary' },
  resolved: { label: 'Fixed', className: 'text-tertiary' },
  failed: { label: 'Auto-fix failed', className: 'text-sev-medium' },
  ai_limit: { label: 'AI limit reached', className: 'text-sev-info' },
  skipped: { label: 'Auto-fix not applicable', className: 'text-on-surface-variant' },
  codebase_wide: { label: 'Codebase-wide change', className: 'text-on-surface-variant' },
}
