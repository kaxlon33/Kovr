import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  BadgeCheck,
  Crosshair,
  GitBranch,
  LoaderCircle,
  Radar,
  ShieldCheck,
  Wrench,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { LogoutButton } from '@/components/layout/LogoutButton'
import { ScoreRing } from '@/components/viz/ScoreRing'
import { useScanStore } from '@/store/useScanStore'
import { useAuthStore, selectIsAdmin } from '@/store/useAuthStore'
import { PILLAR_KEYS, PILLAR_LABELS } from '@/api/types'
import { relativeTime, repoLabel } from '@/lib/format'
import { cn } from '@/lib/cn'

/** The four stages every repo goes through, as a connected stepper. */
const STEPS = [
  { icon: GitBranch, label: 'Clone', desc: 'Shallow, size-checked' },
  { icon: Radar, label: 'Scan', desc: '4 AI analyzers' },
  { icon: Wrench, label: 'Fix', desc: 'Patched server-side' },
  { icon: BadgeCheck, label: 'Verify', desc: 'Re-tested after fix' },
]

function initialsOf(email: string): string {
  const local = email.split('@')[0] ?? ''
  return (local.slice(0, 2) || '?').toUpperCase()
}

/** Decorative radar — rings plus a rotating cyan sweep. Shared with the
 * reconnecting screen. */
export function RadarVisual() {
  return (
    <div className="relative h-52 w-52 shrink-0 sm:h-60 sm:w-60" aria-hidden>
      <div className="absolute inset-0 rounded-full border border-outline-variant" />
      <div className="absolute inset-7 rounded-full border border-outline-variant" />
      <div className="absolute inset-14 rounded-full border border-outline-variant" />
      <div className="absolute left-0 top-1/2 h-px w-full bg-outline-variant/60" />
      <div className="absolute left-1/2 top-0 h-full w-px bg-outline-variant/60" />
      <div className="absolute inset-[47%] rounded-full bg-primary shadow-[0_0_16px_2px_rgba(34,211,238,0.6)]" />
      <div
        className="absolute inset-0 animate-spin rounded-full opacity-60 [animation-duration:5s]"
        style={{
          background: 'conic-gradient(from 0deg, rgba(34,211,238,0.45), transparent 80deg)',
        }}
      />
      <span className="absolute left-[22%] top-[30%] h-1.5 w-1.5 animate-pulse rounded-full bg-tertiary" />
      <span className="absolute left-[68%] top-[62%] h-1.5 w-1.5 animate-pulse rounded-full bg-sev-medium [animation-delay:700ms]" />
      <span className="absolute left-[40%] top-[76%] h-1.5 w-1.5 animate-pulse rounded-full bg-sev-high [animation-delay:1400ms]" />
    </div>
  )
}

export function Connect() {
  const navigate = useNavigate()
  const repoUrl = useScanStore((s) => s.repoUrl)
  const setRepoUrl = useScanStore((s) => s.setRepoUrl)
  const loading = useScanStore((s) => s.loading)
  const error = useScanStore((s) => s.error)
  const setError = useScanStore((s) => s.setError)
  const fixing = useScanStore((s) => s.fixing)
  const verifying = useScanStore((s) => s.verifying)
  const investigating = useScanStore((s) => s.investigating)
  const bulkRunning = useScanStore((s) => s.bulkRunning)
  const activeFindingId = useScanStore((s) => s.activeFindingId)
  const history = useScanStore((s) => s.history)
  const loadScan = useScanStore((s) => s.loadScan)
  const pushToast = useScanStore((s) => s.pushToast)
  const [openingId, setOpeningId] = useState('')

  const user = useAuthStore((s) => s.user)
  const isAdmin = useAuthStore(selectIsAdmin)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!repoUrl.trim()) {
      setError('Please enter a GitHub repo URL')
      return
    }
    // The setup step lets the user pick analyzers before anything runs.
    setError('')
    navigate('/scan-setup')
  }

  const openPrevious = (scanId: string) => {
    if (openingId) return
    setOpeningId(scanId)
    void loadScan(scanId).then((ok) => {
      setOpeningId('')
      if (ok) {
        navigate('/report')
        return
      }
      // A "Scan not found" answer prunes the entry from history — say
      // exactly that instead of a generic failure.
      const pruned = !useScanStore.getState().history.some((h) => h.scanId === scanId)
      pushToast({
        title: pruned ? 'Scan removed from history' : 'Could not open this scan',
        body: pruned
          ? 'It no longer exists on the server — nothing of it remains to open.'
          : 'The backend could not serve its results (it may have been reset). Run a new scan.',
        tone: 'error',
      })
    })
  }

  const operationInProgress = fixing || verifying || Boolean(investigating) || bulkRunning

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-background">
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

      {/* Page-local header — Connect is chromeless, so it carries its own
          identity and the only logout affordance on this screen. */}
      <header className="relative z-10 flex items-center justify-between gap-4 px-6 py-5 md:px-10">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/30 bg-primary/10">
            <ShieldCheck size={19} className="text-primary" />
          </span>
          <div>
            <p className="font-mono text-sm font-bold tracking-tight text-on-surface">KOVR</p>
            <p className="text-[10px] uppercase tracking-wider text-outline">AI security scanner</p>
          </div>
        </div>

        {user && (
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-2 rounded-full border border-outline-variant py-1 pl-1 pr-3 sm:flex">
              <span
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-full border text-[11px] font-bold',
                  isAdmin
                    ? 'border-primary/40 bg-primary/15 text-primary'
                    : 'border-outline-variant bg-surface-container-lowest text-on-surface-variant',
                )}
              >
                {initialsOf(user.email)}
              </span>
              <span className="max-w-40 truncate text-xs text-on-surface">{user.email}</span>
              {isAdmin && (
                <span className="rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-wider text-primary">
                  ADMIN
                </span>
              )}
            </span>

            <LogoutButton variant="ghost" size="sm" />
          </div>
        )}
      </header>

      <main className="animate-fade-up relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center gap-12 px-6 pb-16 pt-4">
        {/* Hero — radar + headline */}
        <div className="flex flex-col items-center gap-8 text-center lg:flex-row lg:gap-14 lg:text-left">
          <RadarVisual />

          <div className="max-w-xl">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[11px] font-medium tracking-wide text-primary">
              <Radar size={12} />
              FOUR ANALYZERS · AUTOMATIC FIXES · VERIFIED RESULTS
            </div>
            <h1 className="mb-4 text-4xl font-semibold leading-tight tracking-tight text-on-surface md:text-5xl">
              Scan your repository.
              <br />
              <span className="text-primary">Ship it fixed.</span>
            </h1>
            <p className="leading-relaxed text-on-surface-variant">
              KOVR reads your code, writes the fixes, and re-tests every one of them. What you
              review is already verified — paste a GitHub URL below to start.
            </p>
          </div>
        </div>

        {/* Scan console — the page's focal instrument: gradient ring,
            glass interior, live scan states. */}
        <form onSubmit={onSubmit} className="w-full max-w-2xl" noValidate>
          <div
            className={cn(
              'relative rounded-2xl p-[1.5px] transition-all duration-300',
              error
                ? 'bg-gradient-to-r from-error/70 via-error/40 to-error/70'
                : 'bg-gradient-to-r from-primary/50 via-primary/15 to-primary/50 focus-within:from-primary focus-within:via-primary/70 focus-within:to-primary focus-within:shadow-[0_0_44px_-10px_rgba(34,211,238,0.5)]',
            )}
          >
            <div className="flex items-center gap-3 rounded-[calc(1rem-0.5px)] bg-[#0a0a0d]/95 px-3.5 py-2.5 backdrop-blur">
              {/* Identity tile — pulses while scanning */}
              <span
                className={cn(
                  'relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition-colors',
                  loading
                    ? 'border-primary/50 bg-primary/10'
                    : 'border-outline-variant bg-surface-container-lowest',
                )}
              >
                <Radar size={17} className="text-primary" aria-hidden />
                {loading && (
                  <span
                    className="absolute inset-0 animate-ping rounded-xl border border-primary/40"
                    aria-hidden
                  />
                )}
              </span>

              <input
                type="text"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                aria-label="Repository URL"
                placeholder="Paste a GitHub repository URL — github.com/owner/repo"
                value={repoUrl}
                onChange={(event) => setRepoUrl(event.target.value)}
                className="min-w-0 flex-1 bg-transparent text-base text-on-surface outline-none placeholder:text-outline"
              />

              <Button
                type="submit"
                variant="primary"
                size="lg"
                disabled={loading}
                aria-label="Scan repository"
                title="Scan repository"
                className="h-11 w-11 shrink-0 rounded-xl p-0"
              >
                {loading ? (
                  <LoaderCircle size={17} className="animate-spin" />
                ) : (
                  <ArrowRight size={17} />
                )}
              </Button>
            </div>
          </div>

          {error && <ErrorBanner message={error} onDismiss={() => setError('')} className="mt-4" />}
        </form>

        {/* A fix/verify/investigation is running — scans are blocked until
            it finishes. Compact popup pill with a jump back to the finding. */}
        {operationInProgress && (
          <div className="-mt-8 flex items-center gap-3 rounded-full border border-primary/40 bg-surface-container/95 py-1.5 pl-2 pr-1.5 shadow-xl shadow-black/40 backdrop-blur">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10">
              <LoaderCircle size={13} className="animate-spin text-primary" />
            </span>
            <span className="min-w-0 flex-1 truncate text-xs">
              <span className="font-semibold text-on-surface">Fix in progress</span>
              <span className="text-on-surface-variant"> — new scans wait until it finishes.</span>
            </span>
            {activeFindingId && (
              <Button
                size="sm"
                variant="primary"
                icon={<Crosshair size={13} />}
                onClick={() => navigate(`/findings/${activeFindingId}`)}
                className="h-7 shrink-0 rounded-full px-3 text-[11px]"
              >
                View finding
              </Button>
            )}
          </div>
        )}

        {/* Pipeline stepper */}
        <ol className="flex w-full max-w-3xl items-start justify-between gap-2">
          {STEPS.map(({ icon: Icon, label, desc }, index) => (
            <li key={label} className="relative flex flex-1 flex-col items-center gap-2 text-center">
              {index < STEPS.length - 1 && (
                <span
                  className="absolute left-[calc(50%+22px)] top-[15px] hidden h-px w-[calc(100%-44px)] bg-outline-variant sm:block"
                  aria-hidden
                />
              )}
              <span className="relative z-10 flex h-9 w-9 items-center justify-center rounded-full border border-primary/30 bg-surface-container/90">
                <Icon size={15} className="text-primary" />
              </span>
              <span>
                <span className="block text-sm font-semibold text-on-surface">{label}</span>
                <span className="mt-0.5 hidden text-[11px] text-on-surface-variant sm:block">
                  {desc}
                </span>
              </span>
            </li>
          ))}
        </ol>

        {/* Analyzer chips */}
        <div className="flex flex-wrap items-center justify-center gap-2">
          {PILLAR_KEYS.map((key) => (
            <span
              key={key}
              className="rounded-md border border-outline-variant px-2.5 py-1 text-[11px] text-on-surface-variant"
            >
              {PILLAR_LABELS[key]}
            </span>
          ))}
          <span className="text-[11px] text-outline">analyzers</span>
        </div>

        {/* Previous runs — straight back into each scan's findings. Only
            entries the user has NOT cleared from history appear here. */}
        {history.length > 0 && (
          <section className="w-full max-w-2xl">
            <div className="mb-3 flex items-center justify-between px-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-outline">
                Recent scans
              </p>
              <button
                type="button"
                onClick={() => navigate('/history')}
                className="text-xs font-medium text-primary transition-colors hover:underline"
              >
                See all
              </button>
            </div>
            <div className="divide-y divide-outline-variant overflow-hidden rounded-xl border border-outline-variant bg-surface-container/60 backdrop-blur">
              {history.slice(0, 4).map((entry) => {
                const opening = openingId === entry.scanId
                return (
                  <button
                    key={entry.scanId}
                    type="button"
                    disabled={opening}
                    onClick={() => openPrevious(entry.scanId)}
                    className="group flex w-full items-center gap-3.5 px-4 py-3 text-left transition-colors hover:bg-surface-container-high/60 disabled:cursor-wait disabled:opacity-70"
                  >
                    <ScoreRing
                      score={entry.score}
                      size={36}
                      thickness={5}
                      label=""
                      className="shrink-0"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-on-surface">
                        {repoLabel(entry.repoUrl)}
                      </span>
                      <span className="block truncate text-[11px] text-on-surface-variant">
                        {relativeTime(entry.at)} ·{' '}
                        {entry.openCount > 0
                          ? `${entry.openCount} open of ${entry.findingCount} findings`
                          : `${entry.findingCount} findings — all clear`}
                      </span>
                    </span>
                    {opening ? (
                      <LoaderCircle size={15} className="shrink-0 animate-spin text-primary" />
                    ) : (
                      <ArrowRight
                        size={15}
                        className="shrink-0 text-outline transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
                      />
                    )}
                  </button>
                )
              })}
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
