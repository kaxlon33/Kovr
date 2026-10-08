import type { ReactNode } from 'react'
import { BadgeCheck, Radar, ShieldCheck, Wrench } from 'lucide-react'

const FEATURES = [
  {
    icon: Radar,
    title: 'Four analyzers, one scan',
    desc: 'Security, API design, backend logic and UI/UX run in parallel.',
  },
  {
    icon: Wrench,
    title: 'Fixes that prove themselves',
    desc: 'Every AI-drafted patch is re-verified before it counts as resolved.',
  },
  {
    icon: BadgeCheck,
    title: 'Your scans stay yours',
    desc: 'Regular accounts see only their own runs. Admins review the instance.',
  },
]

/**
 * Chromeless split layout shared by /login and /register — branding on the
 * left (desktop), the form in a glass card on the right.
 */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string
  subtitle: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="relative flex min-h-screen overflow-hidden bg-background">
      {/* Backdrop */}
      <div className="bg-dot-grid pointer-events-none absolute inset-0 opacity-20" aria-hidden />
      <div
        className="pointer-events-none absolute -left-40 -top-40 h-125 w-125 rounded-full opacity-20 blur-3xl"
        style={{ background: 'radial-gradient(circle, #22d3ee 0%, transparent 70%)' }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -bottom-48 -right-32 h-125 w-125 rounded-full opacity-15 blur-3xl"
        style={{ background: 'radial-gradient(circle, #34d399 0%, transparent 70%)' }}
        aria-hidden
      />
      <div className="pointer-events-none absolute inset-x-0 top-1/3 h-px overflow-hidden" aria-hidden>
        <div className="animate-scan-sweep h-px w-1/3 bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-col items-center justify-center gap-12 px-6 py-12 lg:flex-row lg:gap-20">
        {/* Branding — desktop only */}
        <div className="hidden flex-1 lg:block">
          <div className="mb-6 flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10">
              <ShieldCheck size={22} className="text-primary" />
            </span>
            <div>
              <p className="font-mono text-lg font-bold tracking-tight text-on-surface">KOVR</p>
              <p className="text-[11px] uppercase tracking-wider text-outline">
                AI security scanner
              </p>
            </div>
          </div>

          <h1 className="mb-4 text-4xl font-semibold leading-tight tracking-tight text-on-surface">
            Security scans with
            <br />
            <span className="text-primary">verified fixes.</span>
          </h1>
          <p className="mb-10 max-w-md leading-relaxed text-on-surface-variant">
            Point KOVR at any GitHub repository — the analysis, the patch and the verification all
            happen before a finding ever reaches you.
          </p>

          <ul className="space-y-4">
            {FEATURES.map(({ icon: Icon, title: featureTitle, desc }) => (
              <li key={featureTitle} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-outline-variant bg-surface-container/60">
                  <Icon size={15} className="text-primary" />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-on-surface">{featureTitle}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-on-surface-variant">
                    {desc}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Form card */}
        <div className="w-full max-w-md">
          <div className="relative rounded-2xl border border-outline-variant bg-surface-container/80 p-8 shadow-2xl shadow-black/40 backdrop-blur">
            <div
              className="absolute left-0 top-0 h-px w-full bg-gradient-to-r from-transparent via-primary/40 to-transparent"
              aria-hidden
            />

            <div className="mb-6 flex items-center gap-3 lg:hidden">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/30 bg-primary/10">
                <ShieldCheck size={18} className="text-primary" />
              </span>
              <span className="font-mono text-base font-bold tracking-tight text-on-surface">
                KOVR
              </span>
            </div>

            <h2 className="mb-1 text-xl font-semibold tracking-tight text-on-surface">{title}</h2>
            <p className="mb-6 text-sm text-on-surface-variant">{subtitle}</p>

            {children}
          </div>

          {footer}
        </div>
      </div>
    </div>
  )
}
