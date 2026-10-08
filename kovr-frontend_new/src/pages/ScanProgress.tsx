import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Boxes,
  CheckCheck,
  CircleAlert,
  CircleSlash,
  Database,
  LoaderCircle,
  Network,
  Pause,
  Play,
  ShieldCheck,
  SquareDashedBottomCode,
  X,
  XCircle,
} from 'lucide-react'
import type { PillarStatus, ProgressState } from '@/api/types'
import { PILLAR_KEYS, PILLAR_LABELS, type PillarKey } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { Card, ProgressBar, SectionLabel } from '@/components/ui/primitives'
import { EmptyScanState } from '@/components/ui/EmptyScanState'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { ScoreRing } from '@/components/viz/ScoreRing'
import { useScanStore } from '@/store/useScanStore'
import { repoLabel } from '@/lib/format'
import { cn } from '@/lib/cn'

export const PILLAR_ICON: Record<PillarKey, typeof ShieldCheck> = {
  security: ShieldCheck,
  api_design: Network,
  backend_logic: Boxes,
  ui_ux: SquareDashedBottomCode,
}

export const BLURB: Record<PillarKey, string> = {
  security: 'Vulnerability and dependency analysis.',
  api_design: 'Endpoint structure and payload validation.',
  backend_logic: 'Business rules and data access patterns.',
  ui_ux: 'Frontend components and accessibility.',
}

function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0')
  const seconds = (totalSeconds % 60).toString().padStart(2, '0')
  return `${minutes}:${seconds}`
}

function PillarCard({
  id,
  index,
  pillar,
  paused = false,
}: {
  id: PillarKey
  index: number
  pillar: PillarStatus | undefined
  paused?: boolean
}) {
  const status = pillar?.status ?? 'pending'
  const Icon = PILLAR_ICON[id]
  const done = status === 'done'
  const failed = status === 'failed'
  const cancelled = status === 'cancelled'
  const skipped = status === 'skipped'
  const scanning = !done && !failed && !cancelled && !skipped
  const pending = status === 'pending'

  return (
    <Card
      className={cn(
        'relative flex flex-col overflow-hidden p-5 transition-all duration-300',
        scanning && 'border-primary/50 shadow-[0_0_24px_-12px_rgba(34,211,238,0.45)]',
        done && 'border-tertiary/40',
        failed && 'border-error/50',
        (cancelled || skipped) && 'border-outline-variant opacity-60',
        pending && 'opacity-70',
      )}
    >
      {scanning && !paused && (
        <div className="absolute inset-x-0 top-0 h-px overflow-hidden" aria-hidden>
          <div className="animate-scan-sweep h-px w-1/3 bg-gradient-to-r from-transparent via-primary to-transparent" />
        </div>
      )}

      <div className="mb-4 flex items-start justify-between">
          <span
          className={cn(
              'flex h-11 w-11 items-center justify-center rounded-xl border transition-colors',
              failed
                ? 'border-error/30 bg-error/10'
                : done
                  ? 'border-tertiary/30 bg-tertiary/10'
                  : 'border-primary/30 bg-primary/10',
            )}
          >
          <Icon
            size={20}
            className={cn(
              failed ? 'text-error' : done ? 'text-tertiary' : 'text-primary',
              scanning && !paused && 'animate-pulse',
            )}
          />
        </span>

        <div className="flex flex-col items-end gap-1.5">
          <span className="font-mono text-[10px] text-outline">0{index + 1}</span>
          {scanning && !paused && <span className="block h-2 w-2 animate-pulse rounded-full bg-primary" />}
          {done && <CheckCheck size={15} className="text-tertiary" />}
          {failed && <CircleAlert size={15} className="text-error" />}
          {cancelled && <X size={15} className="text-on-surface-variant" />}
          {skipped && <CircleSlash size={15} className="text-outline" />}
        </div>
      </div>

      <h3 className="text-base font-semibold text-on-surface">{PILLAR_LABELS[id]}</h3>
      <p className="mt-1 mb-5 text-sm leading-relaxed text-on-surface-variant">{BLURB[id]}</p>

      <div className="mt-auto">
        {scanning && paused && (
          <span className="flex items-center gap-2 text-on-surface-variant" aria-label="Paused">
            <Pause size={14} />
          </span>
        )}
        {scanning && !paused && (
          <span className="flex items-center gap-2 text-sm text-primary">
            <LoaderCircle size={14} className="animate-spin" />
            Scanning…
          </span>
        )}
        {done && (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-tertiary/30 bg-tertiary/10 px-2.5 py-1 text-xs font-semibold text-tertiary">
              {pillar?.count ?? 0} issue{(pillar?.count ?? 0) === 1 ? '' : 's'}
            </span>
            {pillar?.source === 'cached' && (
              <span className="ml-auto flex items-center gap-1 font-mono text-[10px] text-on-surface-variant">
                <Database size={11} />
                cached
              </span>
            )}
          </div>
        )}
        {failed && (
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-error/30 bg-error/10 px-2.5 py-1 text-xs font-semibold text-error">
              Failed
            </span>
            {pillar?.error && (
              <p className="mt-2 font-mono text-[11px] leading-relaxed text-on-surface-variant">
                {pillar.error}
              </p>
            )}
          </div>
        )}
        {cancelled && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-outline-variant px-2.5 py-1 text-xs font-semibold text-on-surface-variant">
            Cancelled
          </span>
        )}
        {skipped && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-outline-variant px-2.5 py-1 text-xs font-semibold text-on-surface-variant">
            Not scanned
          </span>
        )}
        {pending && <span className="text-sm text-on-surface-variant">Waiting for a thread…</span>}
      </div>
    </Card>
  )
}

export function ScanProgress() {
  const progress = useScanStore((s) => s.progress)
  const scanId = useScanStore((s) => s.scanId)
  const results = useScanStore((s) => s.results)
  const repoUrl = useScanStore((s) => s.repoUrl)
  const error = useScanStore((s) => s.error)
  const setError = useScanStore((s) => s.setError)
  const scanPaused = useScanStore((s) => s.scanPaused)
  const cancellingScan = useScanStore((s) => s.cancellingScan)
  const pauseScan = useScanStore((s) => s.pauseScan)
  const resumeScan = useScanStore((s) => s.resumeScan)
  const cancelScan = useScanStore((s) => s.cancelScan)
  const resetScan = useScanStore((s) => s.resetScan)
  const pushToast = useScanStore((s) => s.pushToast)
  const selectedPillars = useScanStore((s) => s.selectedPillars)
  const navigate = useNavigate()

  const started = Object.keys(progress).length > 0 || Boolean(scanId)
  const hasLiveProgress = Object.keys(progress).length > 0
  // Revisiting a finished scan: no live stream, but the restored results
  // carry everything needed to show the completed console.
  const isRecap = !hasLiveProgress && Boolean(results)
  const complete = Boolean(progress.complete) || isRecap
  const streamError = Boolean(progress.error)

  const recap = useMemo<ProgressState>(() => {
    const byPillar: ProgressState = { complete: true }
    for (const key of PILLAR_KEYS) {
      byPillar[key] = selectedPillars.includes(key)
        ? {
            status: 'done',
            count: (results?.findings ?? []).filter((f) => f.pillar === key).length,
            source: 'live',
          }
        : { status: 'skipped' }
    }
    return byPillar
  }, [results, selectedPillars])

  const view = hasLiveProgress ? progress : recap

  // Only the analyzers the user picked are shown — deselected ones never
  // appear here, chosen or not.
  const activeKeys = PILLAR_KEYS.filter((key) => selectedPillars.includes(key))

  /* Live elapsed timer — frozen while paused and once the run completes. */
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (complete || scanPaused) return
    const timer = setInterval(() => setElapsed((seconds) => seconds + 1), 1000)
    return () => clearInterval(timer)
  }, [complete, scanPaused])

  // Auto-advance ONLY when the scan finishes while the user is watching.
  // Arriving after it already finished keeps the completed console here —
  // "View findings" moves on when the user chooses to.
  const wasCompleteOnMount = useRef(complete)
  useEffect(() => {
    if (progress.complete && results && !wasCompleteOnMount.current) {
      const timeout = setTimeout(() => navigate('/report', { replace: true }), 900)
      return () => clearTimeout(timeout)
    }
  }, [progress.complete, results, navigate])

  if (!started) {
    return (
      <EmptyScanState
        title="No scan yet"
        message="Clone a repository and run a scan first — or open one of your previous scans from History."
      />
    )
  }

  // The stream itself reported the scan is gone (backend restarted mid-run,
  // or the in-memory scan was lost). Nothing can complete here — offer a
  // clean exit instead of pillars that spin forever.
  if (streamError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
        <CircleAlert size={30} className="text-error" />
        <div>
          <p className="text-lg font-semibold text-on-surface">This scan is no longer running</p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-on-surface-variant">
            The server lost track of it — usually a restart while the analysis was still going.
            Nothing was saved. Start the scan again.
          </p>
        </div>
        <Button
          variant="primary"
          onClick={() => {
            resetScan()
            navigate('/connect')
          }}
        >
          Back to Connect
        </Button>
      </div>
    )
  }

  const settled = activeKeys.filter((key) => {
    const status = view[key]?.status
    return status === 'done' || status === 'failed' || status === 'cancelled' || status === 'skipped'
  }).length
  const overall = activeKeys.length > 0 ? (settled / activeKeys.length) * 100 : 100
  const anyFailed = activeKeys.some((key) => view[key]?.status === 'failed')
  const totalIssues = activeKeys.reduce((sum, key) => sum + (view[key]?.count ?? 0), 0)

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      {/* Backdrop — dotted grid, glows, and the signature scan sweep */}
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
      {!complete && (
        <div className="pointer-events-none absolute inset-x-0 top-24 h-px overflow-hidden" aria-hidden>
          <div className="animate-scan-sweep h-px w-1/3 bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
        </div>
      )}

      <div className="animate-fade-up relative z-10 mx-auto w-full max-w-6xl space-y-8 p-6 md:p-8">
        {/* Header */}
        <header className="flex flex-col justify-between gap-6 border-b border-outline-variant pb-6 md:flex-row md:items-center">
          <div className="min-w-0">
            <div
              className={cn(
                'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-medium tracking-wide',
                complete
                  ? 'border-tertiary/40 bg-tertiary/10 text-tertiary'
                  : scanPaused
                    ? 'border-outline-variant bg-surface-container-low text-on-surface-variant'
                    : 'border-primary/30 bg-primary/10 text-primary',
              )}
            >
              {complete ? (
                <CheckCheck size={12} />
              ) : scanPaused ? (
                <Pause size={12} />
              ) : (
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
              )}
              {complete ? 'SCAN COMPLETE' : scanPaused ? 'SCAN PAUSED' : 'SCAN RUNNING'}
            </div>

            <h2 className="mt-3 truncate text-4xl font-semibold tracking-tight text-on-surface">
              {repoLabel(repoUrl)}
            </h2>

            <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-on-surface-variant">
              {scanId && (
                <code className="rounded bg-surface-container-lowest px-1.5 py-0.5 font-mono text-xs text-primary">
                  {scanId.slice(0, 8)}
                </code>
              )}
              <span>
                {activeKeys.length === PILLAR_KEYS.length
                  ? 'Four analyzers run in parallel, each on its own agent.'
                  : `${activeKeys.length} of 4 analyzers run in parallel, each on its own agent.`}
              </span>
            </p>
          </div>

          <div className="flex items-center gap-6">
            {!isRecap && (
              <div className="text-right">
                <p className="font-mono text-2xl font-bold tabular-nums text-on-surface">
                  {formatElapsed(elapsed)}
                </p>
                <p className="text-[10px] uppercase tracking-wider text-outline">elapsed</p>
              </div>
            )}

            {/* Live scan control: hold a slow run (rate limits, provider
                fallbacks) or abort it and return to Connect. Pause takes
                effect at the next analysis step, not mid-call. */}
            {!complete && (
              <div className="flex w-44 flex-col gap-2">
                <Button
                  size="sm"
                  variant={scanPaused ? 'primary' : 'secondary'}
                  icon={scanPaused ? <Play size={14} /> : <Pause size={14} />}
                  disabled={cancellingScan}
                  className="w-full"
                  onClick={() => {
                    if (scanPaused) {
                      void resumeScan()
                    } else {
                      void pauseScan().then((ok) => {
                        if (ok) {
                          pushToast({
                            title: 'Scan paused',
                            body: 'It resumes from the next analysis step when you press Resume.',
                            tone: 'info',
                          })
                        }
                      })
                    }
                  }}
                >
                  {scanPaused ? 'Resume scan' : 'Pause scan'}
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  icon={
                    cancellingScan ? <LoaderCircle size={13} className="animate-spin" /> : <XCircle size={13} />
                  }
                  disabled={cancellingScan}
                  className="w-full"
                  onClick={() => {
                    void cancelScan().then(() => {
                      pushToast({
                        title: 'Scan cancelled',
                        body: 'The run was stopped and its working copy removed — nothing was saved.',
                        tone: 'info',
                      })
                      navigate('/connect')
                    })
                  }}
                >
                  {cancellingScan ? 'Cancelling…' : 'Cancel scan'}
                </Button>
              </div>
            )}

            {complete && results && (
              <ScoreRing score={results.score} size={84} thickness={8} showGrade className="shrink-0" />
            )}

            {complete && results && (
              <Button variant="primary" onClick={() => navigate('/report')}>
                View findings
              </Button>
            )}
          </div>
        </header>

        {error && <ErrorBanner message={error} onDismiss={() => setError('')} />}

        {/* Pillars */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {PILLAR_KEYS.filter((key) => selectedPillars.includes(key)).map((key, index) => (
            <PillarCard
              key={key}
              id={key}
              index={index}
              pillar={view[key]}
              paused={scanPaused && !complete}
            />
          ))}
        </div>

        {/* Overall progress */}
        <Card className="p-5">
          <div className="mb-4 flex items-end justify-between">
            <div>
              <p className="text-4xl font-bold tabular-nums text-on-surface">
                {Math.round(overall)}
                <span className="text-xl text-on-surface-variant">%</span>
              </p>
              <p className="mt-1 text-xs text-on-surface-variant">Analyzers settled</p>
            </div>
            <p className="font-mono text-sm text-on-surface-variant">
              {settled} / {activeKeys.length}
            </p>
          </div>
          <ProgressBar value={overall} label="Scan progress" tone={anyFailed ? 'error' : 'primary'} />
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="rounded-full border border-outline-variant px-2.5 py-1 font-mono text-[11px] text-on-surface-variant">
              {totalIssues} issues reported so far
            </span>
            <span
              className={cn(
                'rounded-full border px-2.5 py-1 font-mono text-[11px]',
                complete ? 'border-tertiary/40 bg-tertiary/10 text-tertiary' : 'border-primary/30 bg-primary/10 text-primary',
              )}
            >
              {complete ? 'stream closed' : scanPaused ? 'stream paused' : 'streaming…'}
            </span>
          </div>
        </Card>

        {/* Stream terminal */}
        <section>
          <SectionLabel className="mb-3">Stream</SectionLabel>
          <div className="overflow-hidden rounded-xl border border-outline-variant bg-[#07070a]">
            <div className="flex items-center gap-2 border-b border-outline-variant bg-surface-container-low px-4 py-2.5">
              <span className="h-2.5 w-2.5 rounded-full bg-sev-critical/70" aria-hidden />
              <span className="h-2.5 w-2.5 rounded-full bg-sev-medium/70" aria-hidden />
              <span className="h-2.5 w-2.5 rounded-full bg-tertiary/70" aria-hidden />
              <span className="ml-2 font-mono text-[11px] text-on-surface-variant">
                kovr · live stream{scanId ? ` · ${scanId.slice(0, 8)}` : ''}
              </span>
              {!complete && (
                <span className="ml-auto flex items-center gap-1.5 font-mono text-[10px] font-semibold text-primary">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" aria-hidden />
                  LIVE
                </span>
              )}
            </div>

            <div className="p-4 font-mono text-xs leading-relaxed">
              {activeKeys.map((key) => {
                const pillar = view[key]
                const status = pillar?.status ?? 'pending'
                const pausedHere = scanPaused && !complete && status === 'running'
                return (
                  <div key={key} className="flex gap-3">
                    <span className="w-32 shrink-0 text-outline">[{key}]</span>
                    <span
                      className={cn(
                        status === 'done' && 'text-tertiary',
                        status === 'failed' && 'text-error',
                        pausedHere && 'text-primary',
                        status !== 'done' && status !== 'failed' && !pausedHere && 'text-on-surface-variant',
                      )}
                    >
                      {status === 'done'
                        ? `done — ${pillar?.count ?? 0} issues${pillar?.source === 'cached' ? ' (cached)' : ''}`
                        : status === 'failed'
                          ? `failed — ${pillar?.error ?? 'analyzer error'}`
                          : status === 'cancelled'
                            ? 'cancelled'
                            : pausedHere
                              ? 'paused'
                              : status === 'pending'
                                ? 'queued…'
                                : 'scanning…'}
                    </span>
                  </div>
                )
              })}
              {complete && (
                <div className="mt-1 flex gap-3">
                  <span className="w-32 shrink-0 text-outline">[stream]</span>
                  <span className="text-tertiary">complete — results ready</span>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
