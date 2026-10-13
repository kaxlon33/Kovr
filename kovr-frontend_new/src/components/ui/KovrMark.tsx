import { ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * THE KOVR brand mark — one definition used everywhere (sidebar, Connect
 * header, auth pages, splash). Tile: 40px rounded-xl, cyan border/tint,
 * cyan shield. Wordmark: mono, text-sm, bold, tight tracking.
 */
export function KovrMark({ withCaption = true, className }: { withCaption?: boolean; className?: string }) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/10">
        <ShieldCheck size={19} className="text-primary" />
      </span>
      <div className="min-w-0">
        <p className="font-mono text-sm font-bold tracking-tight text-on-surface">KOVR</p>
        {withCaption && (
          <p className="text-[10px] uppercase tracking-wider text-outline">AI security scanner</p>
        )}
      </div>
    </div>
  )
}
