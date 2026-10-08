import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  FolderGit2,
  History as HistoryIcon,
  LoaderCircle,
  Trash2,
  X,
} from 'lucide-react'
import { Button, IconButton } from '@/components/ui/Button'
import { Card, SectionLabel } from '@/components/ui/primitives'
import { Modal } from '@/components/ui/Modal'
import { ScoreHistory } from '@/components/viz/Charts'
import { ScoreRing } from '@/components/viz/ScoreRing'
import { useScanStore } from '@/store/useScanStore'
import { relativeTime, repoLabel } from '@/lib/format'

export function SessionHistory() {
  const history = useScanStore((s) => s.history)
  const entries = Array.isArray(history) ? history : []
  const [confirming, setConfirming] = useState(false)
  const [openingId, setOpeningId] = useState('')
  const loadScan = useScanStore((s) => s.loadScan)
  const clearHistory = useScanStore((s) => s.clearHistory)
  const removeHistoryEntry = useScanStore((s) => s.removeHistoryEntry)
  const pushToast = useScanStore((s) => s.pushToast)
  const navigate = useNavigate()

  const openScan = (scanId: string) => {
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

  if (entries.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
        <HistoryIcon size={30} className="text-outline" />
        <p className="max-w-sm text-on-surface-variant">
          No scans yet in this browser. History is kept locally — the backend has no scan-listing endpoint.
        </p>
        <Button variant="primary" onClick={() => navigate('/connect')}>
          Connect a repository
        </Button>
      </div>
    )
  }

  const chronological = [...entries].reverse()

  return (
    <div className="animate-fade-up mx-auto w-full max-w-5xl space-y-8 p-6 md:p-8">
      <header className="flex flex-col justify-between gap-4 border-b border-outline-variant pb-6 md:flex-row md:items-end">
        <div>
          <h1 className="mb-2 text-4xl font-semibold tracking-tight text-on-surface">Scan History</h1>
          <p className="text-sm text-on-surface-variant">
            Scans run from this browser. Selecting one re-reads its results from the backend.
          </p>
        </div>
        <Button variant="danger" icon={<Trash2 size={15} />} onClick={() => setConfirming(true)}>
          Clear history
        </Button>
      </header>

      {/* Destructive action — confirm, then return the user to the start
          page since there is nothing left to show here. */}
      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Clear all scan history?"
        description="Every scan and its results will be permanently deleted."
      >
        <div className="flex justify-end gap-2 p-5">
          <Button onClick={() => setConfirming(false)}>Cancel</Button>
          <Button
            variant="danger"
            icon={<Trash2 size={15} />}
            onClick={() => {
              clearHistory()
              navigate('/connect')
            }}
          >
            Clear history
          </Button>
        </div>
      </Modal>

      <section>
        <SectionLabel className="mb-4">Score by scan</SectionLabel>
        <Card className="p-6">
          <ScoreHistory
            values={chronological
              .slice(-10)
              .map((entry) => ({ label: repoLabel(entry.repoUrl).split('/').pop() ?? '', score: entry.score }))}
          />
        </Card>
      </section>

      <section>
        <SectionLabel className="mb-4">Runs</SectionLabel>
        <Card className="divide-y divide-outline-variant">
          {entries.map((entry) => (
            <div
              key={entry.scanId}
              className="group flex flex-wrap items-center gap-4 px-4 py-4 transition-colors hover:bg-surface-container-high/60"
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/10">
                <FolderGit2 size={19} className="text-primary" />
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-on-surface">{repoLabel(entry.repoUrl)}</p>
                <p className="truncate font-mono text-[11px] text-on-surface-variant">
                  {entry.scanId} · {relativeTime(entry.at)}
                </p>
              </div>

              <ScoreRing score={entry.score} size={48} thickness={7} label="" className="shrink-0" />

              {entry.openCount > 0 ? (
                <span className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-sev-high/30 bg-sev-high/10 px-3 text-xs font-semibold text-sev-high">
                  <CircleAlert size={13} />
                  {entry.openCount} open
                  <span className="font-normal opacity-70">of {entry.findingCount}</span>
                </span>
              ) : (
                <span className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-tertiary/30 bg-tertiary/10 px-3 text-xs font-semibold text-tertiary">
                  <CheckCircle2 size={13} />
                  All clear
                </span>
              )}

              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="primary"
                  disabled={openingId === entry.scanId}
                  trailing={
                    openingId === entry.scanId ? (
                      <LoaderCircle size={14} className="animate-spin" />
                    ) : (
                      <ArrowRight size={14} />
                    )
                  }
                  onClick={() => openScan(entry.scanId)}
                >
                  {openingId === entry.scanId ? 'Opening…' : 'Open'}
                </Button>
                <IconButton
                  label="Remove this scan from history"
                  onClick={() => removeHistoryEntry(entry.scanId)}
                  className="h-8 w-8 border border-outline-variant hover:border-error/50 hover:bg-error/10 hover:text-error"
                >
                  <X size={14} />
                </IconButton>
              </div>
            </div>
          ))}
        </Card>
      </section>
    </div>
  )
}
