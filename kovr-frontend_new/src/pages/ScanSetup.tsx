import { Navigate, useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, Languages, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/primitives'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { PILLAR_KEYS, PILLAR_LABELS, type PillarKey } from '@/api/types'
import { BLURB, PILLAR_ICON } from '@/pages/ScanProgress'
import { useScanStore } from '@/store/useScanStore'
import { repoLabel } from '@/lib/format'
import { cn } from '@/lib/cn'

/**
 * Pre-scan setup: pick which of the four analyzers should run. All are on
 * by default — most users want the full sweep. Languages are deliberately
 * NOT a choice: detection is automatic and asking would only risk files
 * being skipped by mistake.
 */
export function ScanSetup() {
  const navigate = useNavigate()
  const repoUrl = useScanStore((s) => s.repoUrl)
  const selected = useScanStore((s) => s.selectedPillars)
  const togglePillar = useScanStore((s) => s.togglePillar)
  const startScan = useScanStore((s) => s.startScan)
  const loading = useScanStore((s) => s.loading)
  const error = useScanStore((s) => s.error)
  const setError = useScanStore((s) => s.setError)

  if (!repoUrl.trim()) return <Navigate to="/connect" replace />

  const allSelected = selected.length === PILLAR_KEYS.length

  const selectAll = () => {
    for (const key of PILLAR_KEYS) {
      if (!selected.includes(key)) togglePillar(key)
    }
  }

  const start = async () => {
    if (selected.length === 0) {
      setError('Select at least one analyzer — or go back and scan everything.')
      return
    }
    const scanId = await startScan()
    if (scanId) navigate('/scan')
  }

  return (
    <div className="animate-fade-up mx-auto w-full max-w-3xl space-y-8 p-6 md:p-8">
      <header className="border-b border-outline-variant pb-6">
        <h1 className="mb-2 text-4xl font-semibold tracking-tight text-on-surface">
          Choose what to scan
        </h1>
        <p className="text-sm leading-relaxed text-on-surface-variant">
          All four analyzers run by default — turn off the ones you don&apos;t need. Every choice
          remembers for next time.
        </p>
        <code
          className="mt-4 inline-block max-w-full truncate rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-1.5 font-mono text-xs text-primary"
          title={repoUrl}
        >
          {repoLabel(repoUrl)}
        </code>
      </header>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-outline">Analyzers</p>
          {!allSelected && (
            <button
              type="button"
              onClick={selectAll}
              className="text-xs font-medium text-primary transition-colors hover:underline"
            >
              Select all
            </button>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {PILLAR_KEYS.map((key: PillarKey) => {
            const Icon = PILLAR_ICON[key]
            const on = selected.includes(key)
            return (
              <button
                key={key}
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => togglePillar(key)}
                className={cn(
                  'group relative rounded-xl border p-5 text-left transition-all duration-200',
                  on
                    ? 'border-tertiary/60 bg-tertiary/5 shadow-[0_0_24px_-14px_rgba(52,211,153,0.5)]'
                    : 'border-outline-variant opacity-60 hover:opacity-80',
                )}
              >
                <div className="mb-4 flex items-start justify-between">
                  <span
                    className={cn(
                      'flex h-11 w-11 items-center justify-center rounded-xl border transition-colors',
                      on
                        ? 'border-tertiary/40 bg-tertiary/10'
                        : 'border-outline-variant bg-surface-container-lowest',
                    )}
                  >
                    <Icon size={20} className={on ? 'text-tertiary' : 'text-on-surface-variant'} />
                  </span>
                  <span
                    className={cn(
                      'flex h-6 w-6 items-center justify-center rounded-md border transition-all',
                      on ? 'border-tertiary bg-tertiary text-on-tertiary' : 'border-outline-variant',
                    )}
                    aria-hidden
                  >
                    {on && <Check size={13} />}
                  </span>
                </div>
                <h3 className="text-base font-semibold text-on-surface">{PILLAR_LABELS[key]}</h3>
                <p className="mt-1 text-sm leading-relaxed text-on-surface-variant">{BLURB[key]}</p>
              </button>
            )
          })}
        </div>

        <p className="mt-3 px-1 text-xs text-on-surface-variant">
          {selected.length} of {PILLAR_KEYS.length} analyzers selected — the score covers only what
          runs.
        </p>
      </section>

      <Card className="flex items-start gap-3.5 p-5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/10">
          <Languages size={17} className="text-primary" />
        </span>
        <div>
          <p className="text-sm font-medium text-on-surface">No language picking needed</p>
          <p className="mt-1 text-sm leading-relaxed text-on-surface-variant">
            KOVR detects each file&apos;s language and routes it to the right analyzer automatically —
            30+ languages across backend, API and frontend code.
          </p>
        </div>
      </Card>

      {error && <ErrorBanner message={error} onDismiss={() => setError('')} />}

      <div className="flex items-center justify-between border-t border-outline-variant pt-6">
        <Button variant="ghost" icon={<ArrowLeft size={15} />} onClick={() => navigate('/connect')}>
          Back
        </Button>
        <Button
          variant="primary"
          trailing={loading ? <LoaderCircle size={15} className="animate-spin" /> : <ArrowRight size={15} />}
          disabled={loading || selected.length === 0}
          onClick={() => void start()}
        >
          {loading
            ? 'Starting…'
            : `Scan ${selected.length === PILLAR_KEYS.length ? 'everything' : `${selected.length} analyzer${selected.length === 1 ? '' : 's'}`}`}
        </Button>
      </div>
    </div>
  )
}
