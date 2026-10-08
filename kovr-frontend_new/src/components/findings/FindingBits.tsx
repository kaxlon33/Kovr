import { Link } from 'react-router-dom'
import { ChevronRight, Eye, FileCode2 } from 'lucide-react'
import type { Finding } from '@/api/types'
import { PILLAR_LABELS, type PillarKey } from '@/api/types'
import { BULK_STATUS_META, displayTool, findingLocation, severityMeta } from '@/lib/format'
import { useScanStore } from '@/store/useScanStore'
import { cn } from '@/lib/cn'

export function pillarLabel(pillar: string) {
  return PILLAR_LABELS[pillar as PillarKey] ?? pillar
}

/* ── Severity badge ──────────────────────────────────────────────── */

export function SeverityBadge({ severity, className }: { severity: string; className?: string }) {
  const meta = severityMeta(severity)
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium',
        meta.bg,
        meta.text,
        meta.border,
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />
      {meta.label}
    </span>
  )
}

export function BulkStatusPill({ status }: { status: string }) {
  const meta = BULK_STATUS_META[status] ?? { label: status, className: 'text-on-surface-variant' }
  return <span className={cn('text-xs font-medium', meta.className)}>{meta.label}</span>
}

/* ── Finding row ─────────────────────────────────────────────────── */

interface FindingRowProps {
  finding: Finding
  selected: boolean
  onToggleSelect: () => void
  selectDisabled?: boolean
  bulkStatus?: string
  onRetry?: () => void
  active?: boolean
  onFocus?: () => void
  /** True when this is the finding the user last opened — highlighted on
   * return to the list so they can see what they clicked. */
  viewed?: boolean
}

export function FindingRow({
  finding,
  selected,
  onToggleSelect,
  selectDisabled,
  bulkStatus,
  onRetry,
  active,
  onFocus,
  viewed,
}: FindingRowProps) {
  const resolved = finding.verified === 'resolved'
  const developerMode = useScanStore((s) => s.settings.developerMode)

  return (
    <div
      id={`finding-row-${finding.id}`}
      onMouseEnter={onFocus}
      className={cn(
        'density-row group flex items-center gap-3 border-l-2 px-4 py-4 transition-colors',
        viewed
          ? 'border-l-primary bg-primary/5'
          : 'border-l-transparent hover:bg-surface-container-high',
        active && !viewed && 'bg-surface-container-high',
        resolved && 'opacity-55',
      )}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggleSelect}
        disabled={selectDisabled || resolved}
        aria-label={`Select finding: ${finding.title}`}
        className="h-4 w-4 shrink-0 accent-primary"
      />

      <Link
        to={`/findings/${finding.id}`}
        className="flex min-w-0 flex-1 flex-col gap-3 md:flex-row md:items-center"
      >
        {/* Fixed, centered badge column — keeps Critical/Medium/Low aligned
            in a straight line across every row. */}
        <span className="flex w-28 shrink-0 justify-center md:justify-start">
          <SeverityBadge severity={finding.severity} />
        </span>

        <span className="min-w-0 flex-1">
          <span className="mb-1 flex items-center gap-2">
            <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
              {pillarLabel(finding.pillar)}
            </span>
            {viewed && (
              <span className="flex shrink-0 items-center gap-1 rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                <Eye size={10} aria-hidden />
                Viewed
              </span>
            )}
            <span className="truncate text-sm font-medium text-on-surface transition-colors group-hover:text-primary">
              {finding.title}
            </span>
          </span>
          <span className="flex items-center gap-2 font-mono text-xs text-on-surface-variant">
            <FileCode2 size={13} className="shrink-0" aria-hidden />
            <span className="truncate">{findingLocation(finding)}</span>
            {/* The internal AI tool name adds no signal next to the file —
                only real scanners (gitleaks, semgrep) are worth showing. */}
            {displayTool(finding.tool) && (
              <>
                <span className="text-outline">|</span>
                <span className="shrink-0">{displayTool(finding.tool)}</span>
              </>
            )}
          </span>
          {developerMode && (
            <span className="mt-1 flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-outline">
              <span className="rounded border border-outline-variant px-1 py-px">
                scope={finding.scope ?? 'local'}
              </span>
              <span
                className={cn(
                  'rounded border px-1 py-px',
                  resolved
                    ? 'border-tertiary/40 text-tertiary'
                    : finding.verified === 'failed'
                      ? 'border-error/40 text-error'
                      : 'border-outline-variant',
                )}
              >
                verified={finding.verified ?? 'pending'}
              </span>
              <span className="rounded border border-outline-variant px-1 py-px truncate" title={finding.id}>
                id={finding.id.slice(0, 8)}
              </span>
            </span>
          )}
          {bulkStatus && (
            <span className="mt-1.5 flex items-center gap-2">
              <BulkStatusPill status={bulkStatus} />
              {(bulkStatus === 'failed' || bulkStatus === 'skipped') && onRetry && (
                <button
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    onRetry()
                  }}
                  className="rounded border border-outline-variant px-2 py-0.5 text-[11px] text-on-surface-variant transition-colors hover:border-primary/40 hover:text-primary"
                >
                  Retry
                </button>
              )}
            </span>
          )}
        </span>

        <ChevronRight
          size={18}
          className="hidden shrink-0 text-on-surface-variant transition-colors group-hover:text-on-surface md:block"
        />
      </Link>
    </div>
  )
}

/* ── Before / after code ─────────────────────────────────────────── */

export function CodeDiff({ before, after, file }: { before: string; after: string; file?: string }) {
  const beforeLines = before.split('\n')
  const afterLines = after.split('\n')

  return (
    <div className="overflow-hidden rounded-lg border border-outline-variant bg-surface-container-lowest">
      <div className="flex items-center justify-between gap-4 border-b border-outline-variant bg-surface-container-highest px-4 py-2">
        <span className="flex min-w-0 items-center gap-2 font-mono text-xs text-on-surface-variant">
          <FileCode2 size={14} className="shrink-0" aria-hidden />
          <span className="truncate">{file ?? 'Suggested change'}</span>
        </span>
        <span className="shrink-0 text-[11px] font-medium text-tertiary">Suggested fix</span>
      </div>
      <div className="overflow-x-auto p-3 font-mono text-xs leading-relaxed">
        {beforeLines.map((line, index) => (
          <div key={`b-${index}`} className="flex gap-3 bg-error/10">
            <span className="w-4 shrink-0 select-none text-center text-error">-</span>
            <span className="whitespace-pre text-on-error-container">{line}</span>
          </div>
        ))}
        {afterLines.map((line, index) => (
          <div key={`a-${index}`} className="mt-px flex gap-3 bg-tertiary/10">
            <span className="w-4 shrink-0 select-none text-center text-tertiary">+</span>
            <span className="whitespace-pre text-tertiary-dim">{line}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
