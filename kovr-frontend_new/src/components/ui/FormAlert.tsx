import { CircleAlert } from 'lucide-react'

/** Standard inline form error — the same alert production apps use:
 * icon, message, consistent tone, no shouting. */
export function FormAlert({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-lg border border-error/40 bg-error/10 px-3 py-2.5"
    >
      <CircleAlert size={15} className="mt-0.5 shrink-0 text-error" aria-hidden />
      <p className="text-sm leading-snug text-on-surface">{children}</p>
    </div>
  )
}
