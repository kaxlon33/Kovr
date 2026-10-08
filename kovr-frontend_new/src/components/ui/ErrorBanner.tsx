import { AlertTriangle, Gauge, X } from 'lucide-react'
import { parseRateLimitError } from '@/api/client'
import { cn } from '@/lib/cn'

/**
 * Renders a backend error. A quota message is recognised through the backend's
 * own wording and shown as a dedicated card, exactly as the original UI did.
 */
export function ErrorBanner({
  message,
  onDismiss,
  className,
}: {
  message: string
  onDismiss?: () => void
  className?: string
}) {
  if (!message) return null

  const rateLimit = parseRateLimitError(message)

  if (rateLimit) {
    return (
      <div
        role="alert"
        className={cn(
          'flex items-start gap-3 rounded-lg border border-sev-medium/30 bg-sev-medium/5 px-4 py-3',
          className,
        )}
      >
        <Gauge size={18} className="mt-0.5 shrink-0 text-sev-medium" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-sev-medium">Daily AI quota reached</p>
          <p className="mt-1 text-xs text-on-surface-variant">
            Used {rateLimit.used} / {rateLimit.limit} tokens today
            {rateLimit.requested && <> · this request needed {rateLimit.requested}</>}
            {rateLimit.retryIn && <> · try again in {rateLimit.retryIn}</>}
          </p>
        </div>
        {onDismiss && (
          <button
            aria-label="Dismiss error"
            onClick={onDismiss}
            className="text-on-surface-variant transition-colors hover:text-on-surface"
          >
            <X size={14} />
          </button>
        )}
      </div>
    )
  }

  return (
    <div
      role="alert"
      className={cn('flex items-start gap-3 rounded-lg border border-error/30 bg-error/5 px-4 py-3', className)}
    >
      <AlertTriangle size={18} className="mt-0.5 shrink-0 text-error" aria-hidden />
      <p className="min-w-0 flex-1 text-sm text-on-error-container">{message}</p>
      {onDismiss && (
        <button
          aria-label="Dismiss error"
          onClick={onDismiss}
          className="text-on-surface-variant transition-colors hover:text-on-surface"
        >
          <X size={14} />
        </button>
      )}
    </div>
  )
}
