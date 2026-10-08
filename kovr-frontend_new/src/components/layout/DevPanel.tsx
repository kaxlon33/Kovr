import { useEffect, useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  LoaderCircle,
  Plus,
  RotateCcw,
  Save,
  Server,
  Terminal,
  X,
} from 'lucide-react'
import { fetchDevInfo, fetchModelSettings, updateModelSettings } from '@/api/client'
import type { DevInfo, ModelChainEntry, ModelSettings } from '@/api/types'
import { useScanStore } from '@/store/useScanStore'
import { cn } from '@/lib/cn'

const MAX_CHAIN_LENGTH = 5

/**
 * Developer diagnostics drawer. The floating toggle only exists while
 * Developer mode is on. The provider chain is editable here — reorder,
 * swap models (validated server-side against the known-good list) — and
 * the fallback safety net is always preserved since the chain is an
 * ordered list, never a single model.
 */
export function DevPanel() {
  const developerMode = useScanStore((s) => s.settings.developerMode)
  const open = useScanStore((s) => s.devPanelOpen)
  const setOpen = useScanStore((s) => s.setDevPanelOpen)
  const pushToast = useScanStore((s) => s.pushToast)

  const [info, setInfo] = useState<DevInfo | null>(null)
  const [models, setModels] = useState<ModelSettings | null>(null)
  const [draft, setDraft] = useState<ModelChainEntry[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open || loading) return
    const stale = (!info || !models) && !error
    if (!stale) return
    setLoading(true)
    Promise.all([fetchDevInfo(), fetchModelSettings()])
      .then(([devInfo, modelSettings]) => {
        setInfo(devInfo)
        setModels(modelSettings)
        setDraft(modelSettings.chain)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load dev info'))
      .finally(() => setLoading(false))
  }, [open, info, models, loading, error])

  if (!developerMode) return null

  const dirty =
    JSON.stringify(draft) !== JSON.stringify(models?.chain ?? []) || draft.length === 0

  const moveEntry = (index: number, delta: number) => {
    const target = index + delta
    if (target < 0 || target >= draft.length) return
    const next = [...draft]
    const [entry] = next.splice(index, 1)
    next.splice(target, 0, entry)
    setDraft(next)
  }

  const changeProvider = (index: number, label: string) => {
    const firstModel = models?.available[label]?.[0] ?? ''
    setDraft(draft.map((entry, i) => (i === index ? { label, model: firstModel } : entry)))
  }

  const changeModel = (index: number, model: string) => {
    setDraft(draft.map((entry, i) => (i === index ? { ...entry, model } : entry)))
  }

  const removeEntry = (index: number) => setDraft(draft.filter((_, i) => i !== index))

  const addEntry = () => {
    if (draft.length >= MAX_CHAIN_LENGTH) return
    setDraft([...draft, { label: 'groq', model: models?.available.groq?.[0] ?? '' }])
  }

  const resetDraft = () => setDraft(models ? [...models.default_chain] : [])

  const save = async () => {
    setSaving(true)
    try {
      const result = await updateModelSettings(draft)
      if (result.error) {
        pushToast({ title: 'Could not update model chain', body: result.error, tone: 'error' })
      } else {
        pushToast({
          title: 'Model chain updated',
          body: 'New AI requests walk the updated order immediately. Resets to .env defaults on backend restart.',
          tone: 'success',
        })
        const fresh = await fetchModelSettings()
        setModels(fresh)
        setDraft(fresh.chain)
        setInfo(null) // refetch dev info so the chain list reflects the change
      }
    } catch (err) {
      pushToast({
        title: 'Could not update model chain',
        body: err instanceof Error ? err.message : 'Request failed',
        tone: 'error',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      {/* Floating toggle */}
      <button
        type="button"
        aria-label={open ? 'Close developer panel' : 'Open developer panel'}
        title="Developer panel"
        onClick={() => setOpen(!open)}
        className={cn(
          'fixed bottom-6 right-6 z-90 flex h-11 w-11 items-center justify-center rounded-xl border transition-all',
          'shadow-lg shadow-black/40 active:scale-95',
          open
            ? 'border-primary bg-primary text-on-primary'
            : 'border-primary/40 bg-surface-container/90 text-primary backdrop-blur hover:border-primary',
        )}
      >
        {open ? <X size={18} /> : <Terminal size={18} />}
      </button>

      {/* Drawer */}
      {open && (
        <>
          <div
            className="fixed inset-0 z-90 bg-background/40 backdrop-blur-[2px]"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <aside className="animate-slide-in fixed right-0 top-0 z-100 flex h-full w-full max-w-sm flex-col border-l border-outline-variant bg-surface-container shadow-2xl shadow-black/50">
            <header className="flex items-center justify-between gap-3 border-b border-outline-variant px-4 py-3.5">
              <span className="flex items-center gap-2 text-sm font-semibold text-on-surface">
                <Terminal size={15} className="text-primary" />
                Developer panel
                <span className="rounded-full border border-sev-info/40 bg-sev-info/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-wider text-sev-info">
                  DEV
                </span>
              </span>
              <button
                aria-label="Close developer panel"
                onClick={() => setOpen(false)}
                className="rounded-md p-1 text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
              >
                <X size={15} />
              </button>
            </header>

            <div className="flex-1 space-y-6 overflow-y-auto p-4">
              {loading && (
                <p className="flex items-center gap-2 text-sm text-primary">
                  <LoaderCircle size={14} className="animate-spin" />
                  Reading backend diagnostics…
                </p>
              )}
              {error && (
                <p className="rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-xs text-error">
                  {error}
                </p>
              )}

              {models && (
                <section>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-[11px] uppercase tracking-wider text-outline">
                      AI provider chain
                    </p>
                    {models.last_successful.label && (
                      <span
                        title={models.last_successful.model ?? ''}
                        className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-[9px] font-semibold text-primary"
                      >
                        last used: {models.last_successful.label}
                      </span>
                    )}
                  </div>

                  <div className="space-y-2">
                    {draft.map((entry, index) => (
                      <div
                        key={`${entry.label}-${index}`}
                        className={cn(
                          'rounded-lg border p-2.5',
                          index === 0
                            ? 'border-primary/40 bg-primary/5'
                            : 'border-outline-variant bg-surface-container-lowest',
                        )}
                      >
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1.5 font-mono text-[10px] text-outline">
                            {index === 0 && (
                              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" aria-hidden />
                            )}
                            #{index + 1}
                          </span>
                          <span className="flex items-center gap-0.5">
                            <button
                              aria-label={`Move ${entry.label} up`}
                              disabled={index === 0}
                              onClick={() => moveEntry(index, -1)}
                              className="rounded p-1 text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface disabled:opacity-30"
                            >
                              <ChevronUp size={12} />
                            </button>
                            <button
                              aria-label={`Move ${entry.label} down`}
                              disabled={index === draft.length - 1}
                              onClick={() => moveEntry(index, 1)}
                              className="rounded p-1 text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface disabled:opacity-30"
                            >
                              <ChevronDown size={12} />
                            </button>
                            <button
                              aria-label={`Remove ${entry.label} from chain`}
                              disabled={draft.length <= 1}
                              onClick={() => removeEntry(index)}
                              className="rounded p-1 text-on-surface-variant transition-colors hover:bg-error/10 hover:text-error disabled:opacity-30"
                            >
                              <X size={12} />
                            </button>
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-1.5">
                          <select
                            aria-label="Provider"
                            value={entry.label}
                            onChange={(event) => changeProvider(index, event.target.value)}
                            className="rounded-md border border-outline-variant bg-surface-container-lowest px-1.5 py-1.5 font-mono text-[11px] text-on-surface outline-none focus:border-primary"
                          >
                            {Object.keys(models.available).map((label) => (
                              <option key={label} value={label}>
                                {label}
                              </option>
                            ))}
                          </select>
                          <select
                            aria-label="Model"
                            value={entry.model}
                            onChange={(event) => changeModel(index, event.target.value)}
                            className="rounded-md border border-outline-variant bg-surface-container-lowest px-1.5 py-1.5 font-mono text-[11px] text-on-surface outline-none focus:border-primary"
                          >
                            {(models.available[entry.label] ?? []).map((model) => (
                              <option key={model} value={model}>
                                {model}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-2 flex items-center gap-2">
                    <button
                      onClick={addEntry}
                      disabled={draft.length >= MAX_CHAIN_LENGTH}
                      className="flex items-center gap-1 rounded-md border border-outline-variant px-2 py-1 text-[11px] text-on-surface-variant transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-40"
                    >
                      <Plus size={11} />
                      Add fallback
                    </button>
                    <button
                      onClick={resetDraft}
                      className="flex items-center gap-1 rounded-md border border-outline-variant px-2 py-1 text-[11px] text-on-surface-variant transition-colors hover:border-primary/40 hover:text-primary"
                    >
                      <RotateCcw size={11} />
                      Reset
                    </button>
                    <button
                      onClick={() => void save()}
                      disabled={!dirty || saving}
                      className={cn(
                        'ml-auto flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors',
                        dirty && !saving
                          ? 'border-primary bg-primary text-on-primary'
                          : 'border-outline-variant text-on-surface-variant opacity-50',
                      )}
                    >
                      {saving ? <LoaderCircle size={11} className="animate-spin" /> : <Save size={11} />}
                      Save
                    </button>
                  </div>

                  <p className="mt-2 text-[11px] leading-relaxed text-on-surface-variant">
                    Requests walk this order top-down; a provider drops out only on quota or
                    rate-limit failure. Changes apply immediately and reset to the .env defaults
                    on backend restart. Models are validated against the known-good list — no
                    free text.
                  </p>
                </section>
              )}

              {info && (
                <>
                  {/* LangSmith */}
                  <section>
                    <p className="mb-2 text-[11px] uppercase tracking-wider text-outline">
                      Tracing
                    </p>
                    <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-2.5">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-on-surface-variant">LangSmith</span>
                        <span
                          className={cn(
                            'rounded-full border px-2 py-0.5 text-[10px] font-medium',
                            info.langsmith.tracing_enabled
                              ? 'border-tertiary/40 bg-tertiary/10 text-tertiary'
                              : 'border-outline-variant text-on-surface-variant',
                          )}
                        >
                          {info.langsmith.tracing_enabled ? 'tracing on' : 'tracing off'}
                        </span>
                      </div>
                      <p className="mt-1.5 truncate font-mono text-[11px] text-on-surface-variant">
                        project: {info.langsmith.project}
                      </p>
                      <a
                        href={info.langsmith.dashboard_url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary transition-colors hover:underline"
                      >
                        Open LangSmith dashboard
                        <ExternalLink size={11} />
                      </a>
                    </div>
                  </section>

                  {/* Environment */}
                  <section>
                    <p className="mb-2 text-[11px] uppercase tracking-wider text-outline">
                      Environment (.env)
                    </p>
                    <div className="overflow-hidden rounded-lg border border-outline-variant">
                      {Object.entries(info.env).map(([key, entry]) => (
                        <div
                          key={key}
                          className="flex items-center justify-between gap-3 border-b border-outline-variant bg-surface-container-lowest px-2.5 py-1.5 last:border-b-0"
                        >
                          <span className="shrink-0 font-mono text-[11px] text-on-surface">{key}</span>
                          <span className="flex min-w-0 items-center gap-2">
                            {entry.value && (
                              <span
                                className="truncate font-mono text-[10px] text-on-surface-variant"
                                title={entry.value}
                              >
                                {entry.value}
                              </span>
                            )}
                            <span
                              className={cn(
                                'shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[9px] font-semibold',
                                entry.set
                                  ? 'border-tertiary/40 bg-tertiary/10 text-tertiary'
                                  : 'border-sev-medium/40 bg-sev-medium/10 text-sev-medium',
                              )}
                            >
                              {entry.set ? 'set' : 'not set'}
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                    <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-on-surface-variant">
                      <Server size={11} className="mt-0.5 shrink-0" aria-hidden />
                      Secret values never leave the backend — only whether they are set.
                      Non-sensitive values like model names are shown as-is.
                    </p>
                  </section>
                </>
              )}
            </div>
          </aside>
        </>
      )}
    </>
  )
}
