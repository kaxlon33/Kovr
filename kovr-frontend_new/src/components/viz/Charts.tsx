import { SEVERITY_META, scoreHex, type SeverityKey } from '@/lib/format'
import { cn } from '@/lib/cn'

const ORDER: SeverityKey[] = ['critical', 'error', 'high', 'medium', 'warning', 'low', 'info', 'unknown']

/** Stacked distribution of findings by severity. */
export function SeverityBar({
  counts,
  className,
}: {
  counts: Record<SeverityKey, number>
  className?: string
}) {
  const total = ORDER.reduce((sum, key) => sum + counts[key], 0)

  if (total === 0) {
    return (
      <div className={cn('h-2 w-full overflow-hidden rounded-full bg-tertiary/20', className)}>
        <div className="h-full w-full bg-tertiary/60" />
      </div>
    )
  }

  return (
    <div
      className={cn('flex h-2 w-full overflow-hidden rounded-full bg-surface-container-highest', className)}
      role="img"
      aria-label={ORDER.filter((key) => counts[key] > 0)
        .map((key) => `${counts[key]} ${key}`)
        .join(', ')}
    >
      {ORDER.map((key) =>
        counts[key] > 0 ? (
          <div
            key={key}
            style={{ width: `${(counts[key] / total) * 100}%`, background: SEVERITY_META[key].hex }}
            title={`${counts[key]} ${SEVERITY_META[key].label}`}
          />
        ) : null,
      )}
    </div>
  )
}

/** Score of each scan run in this browser session. */
export function ScoreHistory({
  values,
  className,
}: {
  values: { label: string; score: number }[]
  className?: string
}) {
  if (values.length === 0) {
    return <p className={cn('text-sm text-on-surface-variant', className)}>No scans in this session yet.</p>
  }

  return (
    <div className={cn('flex items-end gap-2', className)} role="img" aria-label="Score by scan">
      {values.map((entry, index) => (
        <div key={`${entry.label}-${index}`} className="flex flex-1 flex-col items-center gap-2">
          <span className="font-mono text-[10px] text-on-surface-variant">{entry.score}</span>
          <div className="flex h-28 w-full items-end">
            <div
              className="w-full rounded-t transition-all duration-500"
              style={{ height: `${Math.max(4, entry.score)}%`, background: scoreHex(entry.score) }}
              title={`${entry.label}: ${entry.score}`}
            />
          </div>
          <span className="w-full truncate text-center text-[10px] text-on-surface-variant" title={entry.label}>
            {entry.label}
          </span>
        </div>
      ))}
    </div>
  )
}
