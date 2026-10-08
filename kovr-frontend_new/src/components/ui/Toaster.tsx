import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { useScanStore } from '@/store/useScanStore'
import { cn } from '@/lib/cn'

const TONE = {
  info: { icon: Info, ring: 'border-outline-variant', text: 'text-primary' },
  success: { icon: CheckCircle2, ring: 'border-tertiary/30', text: 'text-tertiary' },
  warn: { icon: AlertTriangle, ring: 'border-sev-medium/30', text: 'text-sev-medium' },
  error: { icon: XCircle, ring: 'border-error/30', text: 'text-error' },
} as const

export function Toaster() {
  const toasts = useScanStore((s) => s.toasts)
  const dismissToast = useScanStore((s) => s.dismissToast)

  if (toasts.length === 0) return null

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-200 flex w-full max-w-sm flex-col gap-2"
    >
      {toasts.map((toast) => {
        const tone = TONE[toast.tone]
        const Icon = tone.icon
        return (
          <div
            key={toast.id}
            className={cn(
              'animate-slide-in pointer-events-auto flex items-start gap-3 rounded-lg border bg-surface-container-high px-4 py-3',
              tone.ring,
            )}
          >
            <Icon size={18} className={cn('mt-0.5 shrink-0', tone.text)} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-on-surface">{toast.title}</p>
              {toast.body && <p className="mt-0.5 text-xs text-on-surface-variant">{toast.body}</p>}
            </div>
            <button
              aria-label="Dismiss notification"
              onClick={() => dismissToast(toast.id)}
              className="text-on-surface-variant transition-colors hover:text-on-surface"
            >
              <X size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
