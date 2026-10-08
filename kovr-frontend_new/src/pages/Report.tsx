import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Download,
  Eye,
  GitPullRequestArrow,
  Info,
  ListFilter,
  PartyPopper,
  Pause,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  ShieldX,
  TriangleAlert,
  X,
  Zap,
} from 'lucide-react'
import { Button, IconButton } from '@/components/ui/Button'
import { Card, CardHeader, Input, KeyCap, SectionLabel, Select } from '@/components/ui/primitives'
import { EmptyScanState } from '@/components/ui/EmptyScanState'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { DevJson } from '@/components/ui/DevJson'
import { GitHubConnectBanner } from '@/components/layout/GitHubConnectBanner'
import { useGithubStatus } from '@/hooks/useGithubStatus'
import { RestoringScan } from '@/components/layout/RestoringScan'
import { ScoreRing } from '@/components/viz/ScoreRing'
import { SeverityBar } from '@/components/viz/Charts'
import { FindingRow } from '@/components/findings/FindingBits'
import { useScanStore, openFindings } from '@/store/useScanStore'
import {
  SEVERITY_BUCKETS,
  bucketCounts,
  displayTool,
  grade,
  repoLabel,
  scoreTone,
  scoreVerdict,
  severityCounts,
  severityKey,
  SEVERITY_META,
} from '@/lib/format'
import { exportCsv, exportJson, exportMarkdown, exportPdf } from '@/lib/export'
import { cn } from '@/lib/cn'

type SortKey = 'severity' | 'pillar' | 'file'
type BucketKey = 'highCritical' | 'warnings' | 'info'

const BUCKET_CARDS: {
  key: BucketKey
  label: string
  icon: typeof ShieldX
  tone: string
  dot: string
  /** Classes applied when this bucket's filter is active — unmistakable state. */
  active: string
}[] = [
  {
    key: 'highCritical',
    label: 'High & Critical',
    icon: ShieldX,
    tone: 'text-sev-critical',
    dot: 'bg-sev-critical',
    active: 'border-sev-critical/70 bg-sev-critical/10 ring-1 ring-sev-critical/40',
  },
  {
    key: 'warnings',
    label: 'Warnings',
    icon: TriangleAlert,
    tone: 'text-sev-medium',
    dot: 'bg-sev-medium',
    active: 'border-sev-medium/70 bg-sev-medium/10 ring-1 ring-sev-medium/40',
  },
  {
    key: 'info',
    label: 'Info',
    icon: Info,
    tone: 'text-sev-info',
    dot: 'bg-sev-info',
    active: 'border-sev-info/70 bg-sev-info/10 ring-1 ring-sev-info/40',
  },
]

export function Report() {
  const results = useScanStore((s) => s.results)
  const restoring = useScanStore((s) => s.restoring)
  const restorableScanId = useScanStore((s) => s.scanId)
  const error = useScanStore((s) => s.error)
  const setError = useScanStore((s) => s.setError)
  const investigations = useScanStore((s) => s.investigations)
  const selectedIds = useScanStore((s) => s.selectedIds)
  const bulkRunning = useScanStore((s) => s.bulkRunning)
  const fixing = useScanStore((s) => s.fixing)
  const verifying = useScanStore((s) => s.verifying)
  const bulkPaused = useScanStore((s) => s.bulkPaused)
  const toggleBulkPause = useScanStore((s) => s.toggleBulkPause)
  const quotaNote = useScanStore((s) => s.quotaNote)
  const bulkProgress = useScanStore((s) => s.bulkProgress)
  const toggleSelect = useScanStore((s) => s.toggleSelect)
  const selectBySeverity = useScanStore((s) => s.selectBySeverity)
  const clearSelection = useScanStore((s) => s.clearSelection)
  const runBulkApprove = useScanStore((s) => s.runBulkApprove)
  const retryFinding = useScanStore((s) => s.retryFinding)
  const refreshResults = useScanStore((s) => s.refreshResults)
  const developerMode = useScanStore((s) => s.settings.developerMode)
  const lastViewedFindingId = useScanStore((s) => s.lastViewedFindingId)
  const setLastViewedFinding = useScanStore((s) => s.setLastViewedFinding)
  const prStatus = useScanStore((s) => s.prStatus)
  const github = useGithubStatus()
  const prLoading = useScanStore((s) => s.prLoading)
  const fetchPrStatus = useScanStore((s) => s.fetchPrStatus)
  const openPullRequest = useScanStore((s) => s.openPullRequest)
  const setRepoUrl = useScanStore((s) => s.setRepoUrl)
  const navigate = useNavigate()

  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('severity')
  const [showFilters, setShowFilters] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  const [refreshing, setRefreshing] = useState(false)

  /* The severity bucket lives in the store: navigating into a finding
   * detail unmounts this page, and the chosen filter must survive that. */
  const bucketFilter = useScanStore((s) => s.severityFilter)
  const setBucketFilter = useScanStore((s) => s.setSeverityFilter)

  const open = useMemo(() => openFindings(results), [results])

  /* The pipeline writes findings while it runs — refreshing mid-flight
   * would reload the list underneath it, so the button waits. */
  const pipelineBusy = bulkRunning || fixing || verifying

  const onRefresh = async () => {
    if (pipelineBusy) return
    setRefreshing(true)
    try {
      await refreshResults()
    } finally {
      setRefreshing(false)
    }
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = open.filter((finding) => {
      if (bucketFilter !== 'all') {
        const bucket = SEVERITY_BUCKETS[bucketFilter] as readonly string[]
        if (!bucket.includes(severityKey(finding.severity))) return false
      }
      if (!q) return true
      return `${finding.title} ${finding.file} ${finding.pillar} ${displayTool(finding.tool)} ${finding.description}`
        .toLowerCase()
        .includes(q)
    })

    return [...filtered].sort((a, b) => {
      if (sortKey === 'pillar') return a.pillar.localeCompare(b.pillar)
      if (sortKey === 'file') return a.file.localeCompare(b.file)
      return SEVERITY_META[severityKey(a.severity)].order - SEVERITY_META[severityKey(b.severity)].order
    })
  }, [open, query, bucketFilter, sortKey])

  useEffect(() => setCursor(0), [query, bucketFilter, sortKey])

  // Returning from a finding detail: jump the list back to the finding the
  // user just viewed — cursor, highlight and scroll position.
  useEffect(() => {
    if (!lastViewedFindingId) return
    const index = visible.findIndex((f) => f.id === lastViewedFindingId)
    if (index >= 0) {
      setCursor(index)
      requestAnimationFrame(() => {
        document
          .getElementById(`finding-row-${lastViewedFindingId}`)
          ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastViewedFindingId])

  // PR lifecycle state: committed fixes / opened PR for this scan.
  useEffect(() => {
    if (results?.scan_id) void fetchPrStatus(results.scan_id)
  }, [results?.scan_id, fetchPrStatus])

  // The connect step is over once findings are shown — don't leave the
  // previously scanned URL sitting in the Connect input on the next visit.
  useEffect(() => {
    setRepoUrl('')
  }, [setRepoUrl])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (target instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return
      if (visible.length === 0) return

      if (event.key === 'j') {
        event.preventDefault()
        setCursor((c) => Math.min(c + 1, visible.length - 1))
      } else if (event.key === 'k') {
        event.preventDefault()
        setCursor((c) => Math.max(c - 1, 0))
      } else if (event.key === 'x') {
        event.preventDefault()
        const finding = visible[cursor]
        if (finding) toggleSelect(finding.id)
      } else if (event.key === 'Enter') {
        const finding = visible[cursor]
        if (finding) navigate(`/findings/${finding.id}`)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [visible, cursor, navigate, toggleSelect])

  // Nothing loaded: tell the user what to do next instead of silently
  // bouncing them to Connect.
  if (!results) {
    return restoring || restorableScanId ? (
      <RestoringScan />
    ) : (
      <EmptyScanState
        title="No findings yet"
        message="Clone a repository and run a scan first — or open one of your previous scans from History."
      />
    )
  }

  const counts = bucketCounts(open)
  const distribution = severityCounts(open)
  const activeBucket = BUCKET_CARDS.find((b) => b.key === bucketFilter)
  const lastViewedFinding = results.findings.find((f) => f.id === lastViewedFindingId)
  const bulkValues = Object.values(bulkProgress)
  const bulkDone = !bulkRunning && bulkValues.length > 0

  /* Everything the backend returned has been resolved. */
  if (open.length === 0 && results.findings.length > 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="animate-fade-up w-full max-w-md text-center">
          <div className="mb-6 flex justify-center">
            <div className="relative flex h-20 w-20 items-center justify-center rounded-full border border-tertiary/30 bg-tertiary/10">
              <span className="animate-pulse-ring absolute inset-0 scale-125 rounded-full border border-tertiary/20" />
              <PartyPopper size={32} className="text-tertiary" />
            </div>
          </div>
          <h2 className="mb-3 text-4xl font-semibold tracking-tight text-on-surface">All done.</h2>
          <p className="mb-8 text-on-surface-variant">
            {results.findings.length} of {results.findings.length} issues handled in{' '}
            <span className="font-mono text-on-surface">{repoLabel(results.repo_url)}</span>.
          </p>
          <ScoreRing score={results.score} size={180} showGrade className="mx-auto mb-8" />
          <div className="flex flex-col justify-center gap-3 sm:flex-row">
            <Button variant="primary" onClick={() => navigate('/summary')}>
              Open summary
            </Button>
            <Button onClick={() => navigate('/connect')}>Scan another repository</Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      {/* Backdrop — dotted grid and glows, consistent with the other pages */}
      <div className="bg-dot-grid pointer-events-none absolute inset-0 opacity-15" aria-hidden />
      <div
        className="pointer-events-none absolute -left-40 -top-40 h-125 w-125 rounded-full opacity-15 blur-3xl"
        style={{ background: 'radial-gradient(circle, #22d3ee 0%, transparent 70%)' }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -bottom-48 -right-32 h-125 w-125 rounded-full opacity-10 blur-3xl"
        style={{ background: 'radial-gradient(circle, #34d399 0%, transparent 70%)' }}
        aria-hidden
      />

      <div className="animate-fade-up relative z-10 mx-auto w-full max-w-6xl space-y-8 p-6 md:p-8">
      <header className="flex flex-col justify-between gap-6 border-b border-outline-variant pb-6 md:flex-row md:items-center">
        <div className="min-w-0">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[11px] font-medium tracking-wide text-primary">
            <ShieldCheck size={12} />
            ANALYSIS REPORT
          </div>
          <h2 className="truncate text-4xl font-semibold tracking-tight text-on-surface">
            {repoLabel(results.repo_url)}
          </h2>
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-on-surface-variant">
            <code className="rounded bg-surface-container-lowest px-1.5 py-0.5 font-mono text-xs text-primary">
              {results.scan_id}
            </code>
            <span className="text-outline">·</span>
            <span>
              {open.length} open of {results.findings.length} total
            </span>
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <IconButton
            label="Refresh results"
            disabled={pipelineBusy || refreshing}
            title={
              pipelineBusy
                ? 'Unavailable while fixes are being applied or verified'
                : 'Refresh results'
            }
            onClick={() => void onRefresh()}
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : undefined} />
          </IconButton>

          {/* PR lifecycle: commits exist → offer the explicit one-time PR open;
              already open → link straight to GitHub; not connected → send
              the user to connect their own account first. */}
          {prStatus?.pr_url && github?.connected ? (
            <a
              href={prStatus.pr_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-tertiary/40 bg-tertiary/10 px-4 py-2 text-sm font-medium text-tertiary transition-colors hover:bg-tertiary/20"
            >
              <GitPullRequestArrow size={15} />
              View Pull Request
            </a>
          ) : prStatus && prStatus.commit_count > 0 && prStatus.token_configured ? (
            <Button
              variant="primary"
              icon={<GitPullRequestArrow size={16} />}
              disabled={prLoading}
              title={`Push ${prStatus.branch} and open a pull request under your GitHub account (${prStatus.commit_count} verified fix${prStatus.commit_count === 1 ? '' : 'es'})`}
              onClick={() => void openPullRequest()}
            >
              {prLoading ? 'Opening…' : 'Open Pull Request'}
            </Button>
          ) : null}

          <Button variant="primary" onClick={() => navigate('/summary')}>
            Summary
          </Button>

          <div className="relative">
            <Button
              icon={<Download size={16} />}
              trailing={<ChevronDown size={14} />}
              onClick={() => setExportOpen((v) => !v)}
              aria-expanded={exportOpen}
            >
              Export
            </Button>
            {exportOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setExportOpen(false)} aria-hidden />
                <div className="absolute right-0 top-full z-50 mt-2 w-48 overflow-hidden rounded-lg border border-outline-variant bg-surface-container">
                  {[
                    { label: 'Markdown report', run: () => exportMarkdown(results, investigations) },
                    { label: 'JSON', run: () => exportJson(results) },
                    { label: 'CSV of findings', run: () => exportCsv(results) },
                    { label: 'Print / Save as PDF', run: exportPdf },
                  ].map((option) => (
                    <button
                      key={option.label}
                      onClick={() => {
                        option.run()
                        setExportOpen(false)
                      }}
                      className="block w-full px-4 py-2 text-left text-sm text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {error && <ErrorBanner message={error} onDismiss={() => setError('')} />}

      {/* GitHub connection nudge — visible until the user connects */}
      <GitHubConnectBanner />

      {/* Metrics */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <Card className="group relative flex flex-col items-center justify-center overflow-hidden p-6">
          <div
            className="pointer-events-none absolute inset-0 opacity-10 transition-opacity group-hover:opacity-20"
            style={{ background: 'radial-gradient(ellipse at center, rgba(34,211,238,0.3), transparent 70%)' }}
            aria-hidden
          />
          <SectionLabel className="mb-6 w-full text-left">Security Score</SectionLabel>
          <ScoreRing score={results.score} size={160} className="mb-2" />
          <div className={cn('flex items-center gap-2 text-sm font-medium', scoreTone(results.score))}>
            {results.score >= 85 ? <CheckCircle2 size={16} /> : <TriangleAlert size={16} />}
            {scoreVerdict(results.score)}
          </div>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <span className="rounded-full border border-outline-variant px-2.5 py-1 text-[11px] text-on-surface-variant">
              {open.length} open
            </span>
            <span className="rounded-full border border-tertiary/30 bg-tertiary/10 px-2.5 py-1 text-[11px] text-tertiary">
              {results.findings.length - open.length} resolved
            </span>
            <span className="rounded-full border border-outline-variant px-2.5 py-1 text-[11px] text-on-surface-variant">
              grade {grade(results.score)}
            </span>
          </div>
        </Card>

        <Card className="flex flex-col p-6 md:col-span-2">
          <SectionLabel className="mb-6">Open findings by severity</SectionLabel>
          <div className="grid flex-1 grid-cols-1 gap-4 sm:grid-cols-3">
            {BUCKET_CARDS.map(({ key, label, icon: Icon, tone, dot, active: activeClass }) => {
              const active = bucketFilter === key
              return (
                <button
                  key={key}
                  onClick={() => setBucketFilter(active ? 'all' : key)}
                  aria-pressed={active}
                  className={cn(
                    'flex flex-col justify-between rounded-lg border bg-surface-container-lowest p-4 text-left transition-all duration-150 hover:border-outline',
                    active ? `${activeClass} scale-[1.02]` : 'border-outline-variant',
                  )}
                >
                  <span className="mb-4 flex items-center justify-between">
                    <span className={cn('h-3 w-3 rounded-full transition-transform', dot, active && 'scale-125')} />
                    <span className="flex items-center gap-1.5">
                      {active && (
                        <span className="flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-primary">
                          <Check size={9} strokeWidth={3} />
                          Filter
                        </span>
                      )}
                      <Icon size={18} className={cn('text-on-surface-variant', active && tone)} />
                    </span>
                  </span>
                  <span>
                    <span
                      className={cn(
                        'block text-3xl font-bold tabular-nums transition-colors',
                        active ? tone : 'text-on-surface',
                      )}
                    >
                      {counts[key]}
                    </span>
                    <span className="mt-1 block text-sm text-on-surface-variant">{label}</span>
                  </span>
                </button>
              )
            })}
          </div>
          <div className="mt-5 border-t border-outline-variant pt-4">
            <SeverityBar counts={distribution} />
            <p className="mt-3 text-xs text-on-surface-variant">
              {open.length} open of {results.findings.length} total ·{' '}
              {results.findings.length - open.length} resolved
            </p>
          </div>
        </Card>
      </div>

      {/* Bulk pipeline summary */}
      {bulkDone && (
        <Card className="flex items-start gap-3 border-tertiary/30 bg-tertiary/5 p-4">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-tertiary" aria-hidden />
          <p className="text-sm text-on-surface-variant">
            <span className="font-semibold text-on-surface">
              {bulkValues.filter((v) => v === 'resolved').length}
            </span>{' '}
            of <span className="font-semibold text-on-surface">{bulkValues.length}</span> issues fixed
            automatically.
            {bulkValues.filter((v) => v === 'failed').length > 0 && (
              <>
                {' '}
                <span className="font-semibold text-sev-medium">
                  {bulkValues.filter((v) => v === 'failed').length}
                </span>{' '}
                could not be fixed automatically.
              </>
            )}
            {bulkValues.filter((v) => v === 'ai_limit').length > 0 && (
              <>
                {' '}
                <span className="font-semibold text-sev-info">
                  {bulkValues.filter((v) => v === 'ai_limit').length}
                </span>{' '}
                stopped because the AI limit was reached.
              </>
            )}
            {bulkValues.filter((v) => v === 'skipped').length > 0 && (
              <>
                {' '}
                <span className="font-semibold text-on-surface">
                  {bulkValues.filter((v) => v === 'skipped').length}
                </span>{' '}
                can't be auto-fixed (like leaked secrets, which need rotating).
              </>
            )}
          </p>
          {quotaNote && (
            <p className="mt-2 rounded-lg border border-sev-info/30 bg-sev-info/5 px-3 py-2 text-xs text-sev-info">
              {quotaNote}
            </p>
          )}
        </Card>
      )}

      {/* Findings */}
      <Card className="overflow-hidden p-0">
        <CardHeader className="bg-surface-container-highest">
          <h3 className="flex items-center gap-2 text-base font-semibold text-on-surface">
            <ListFilter size={18} />
            Findings
            <span className="font-mono text-xs font-normal text-on-surface-variant">
              {visible.length}/{open.length}
            </span>
          </h3>
          <div className="flex items-center gap-2">
            {lastViewedFinding && visible.some((f) => f.id === lastViewedFindingId) && (
              <span className="hidden items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary sm:inline-flex">
                <Eye size={11} aria-hidden />
                <span className="max-w-44 truncate" title={lastViewedFinding.title}>
                  {lastViewedFinding.title}
                </span>
                <button
                  aria-label="Clear viewed highlight"
                  onClick={() => setLastViewedFinding(null)}
                  className="rounded-full p-0.5 transition-colors hover:bg-primary/15"
                >
                  <X size={11} />
                </button>
              </span>
            )}
            {activeBucket && (
              <span
                className={cn(
                  'hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium text-on-surface sm:inline-flex',
                  activeBucket.active,
                )}
              >
                <span className={cn('h-2 w-2 rounded-full', activeBucket.dot)} />
                {activeBucket.label} · {counts[activeBucket.key]}
                <button
                  aria-label="Clear severity filter"
                  onClick={() => setBucketFilter('all')}
                  className="ml-0.5 rounded-full p-0.5 text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
                >
                  <X size={11} />
                </button>
              </span>
            )}
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search findings…"
              aria-label="Search findings"
              icon={<Search size={15} />}
              className="w-40 py-1.5 sm:w-56"
            />
            <IconButton
              label="Toggle filters"
              active={showFilters}
              onClick={() => setShowFilters((v) => !v)}
              className="border border-outline-variant"
            >
              <ListFilter size={16} />
            </IconButton>
          </div>
        </CardHeader>

        {showFilters && (
          <div className="flex flex-wrap items-center gap-3 border-b border-outline-variant bg-surface-container-low px-4 py-3">
            <label className="flex items-center gap-2 text-xs text-on-surface-variant">
              Severity
              <Select
                value={bucketFilter}
                onChange={(event) => setBucketFilter(event.target.value as BucketKey | 'all')}
                className="py-1"
              >
                <option value="all">All</option>
                <option value="highCritical">High &amp; Critical</option>
                <option value="warnings">Warnings</option>
                <option value="info">Info</option>
              </Select>
            </label>

            <label className="flex items-center gap-2 text-xs text-on-surface-variant">
              Sort by
              <Select
                value={sortKey}
                onChange={(event) => setSortKey(event.target.value as SortKey)}
                className="py-1"
              >
                <option value="severity">Severity</option>
                <option value="pillar">Pillar</option>
                <option value="file">File path</option>
              </Select>
            </label>

            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              onClick={() => {
                setQuery('')
                setBucketFilter('all')
                setSortKey('severity')
              }}
            >
              Reset
            </Button>
          </div>
        )}

        {/* Bulk controls — the buckets and pipeline the backend expects */}
        <div className="flex flex-wrap items-center gap-2 border-b border-outline-variant px-4 py-3">
          <Button
            size="sm"
            disabled={bulkRunning}
            onClick={() => selectBySeverity([...SEVERITY_BUCKETS.highCritical])}
          >
            Select High/Critical
          </Button>
          <Button size="sm" disabled={bulkRunning} onClick={() => selectBySeverity([...SEVERITY_BUCKETS.warnings])}>
            Select Warnings
          </Button>
          <Button size="sm" disabled={bulkRunning} onClick={() => selectBySeverity([...SEVERITY_BUCKETS.info])}>
            Select Info
          </Button>
          {selectedIds.length > 0 && (
            <Button size="sm" variant="ghost" disabled={bulkRunning} onClick={clearSelection}>
              Clear ({selectedIds.length})
            </Button>
          )}
          {bulkRunning && bulkPaused && (
            <span className="text-xs font-medium text-sev-medium">
              Paused — holding after the current finding finishes.
            </span>
          )}
          {bulkRunning ? (
            <Button
              size="sm"
              className="ml-auto"
              icon={bulkPaused ? <Play size={14} /> : <Pause size={14} />}
              onClick={toggleBulkPause}
            >
              {bulkPaused ? 'Resume' : 'Pause'}
            </Button>
          ) : selectedIds.length > 0 ? (
            <Button
              size="sm"
              variant="primary"
              className="ml-auto"
              disabled={bulkRunning}
              icon={<Zap size={14} />}
              onClick={() => void runBulkApprove()}
            >
              {bulkRunning ? 'Processing…' : `Bulk approve (${selectedIds.length})`}
            </Button>
          ) : null}
        </div>

        {selectedIds.length > 0 && !bulkRunning && (
          <p className="border-b border-outline-variant bg-surface-container-low px-4 py-2.5 text-xs leading-relaxed text-on-surface-variant">
            Most issues can be fixed automatically. Some — like leaked secrets or complex logic — may need a
            quick manual look. You'll see exactly why.
          </p>
        )}

        {visible.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-16 text-center">
            <CircleAlert size={24} className="text-outline" />
            <p className="text-sm text-on-surface-variant">
              {open.length === 0
                ? 'This scan produced no findings. Nothing to fix.'
                : activeBucket
                  ? `No open ${activeBucket.label.toLowerCase()} findings — clear the filter to see the rest.`
                  : 'No findings match the current filters.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-outline-variant">
            {visible.map((finding, index) => (
              <FindingRow
                key={finding.id}
                finding={finding}
                selected={selectedIds.includes(finding.id)}
                onToggleSelect={() => toggleSelect(finding.id)}
                selectDisabled={bulkRunning}
                bulkStatus={bulkProgress[finding.id]}
                onRetry={() => void retryFinding(finding.id)}
                active={index === cursor}
                onFocus={() => setCursor(index)}
                viewed={finding.id === lastViewedFindingId}
              />
            ))}
          </div>
        )}
      </Card>

      {developerMode && (
        <section>
          <SectionLabel className="mb-3">Developer data</SectionLabel>
          <DevJson title={`GET /api/scan/${results.scan_id}/results`} data={results} />
        </section>
      )}

      {visible.length > 0 && (
        <p className="flex flex-wrap items-center justify-center gap-2 text-[11px] text-on-surface-variant">
          <span className="flex items-center gap-1">
            <KeyCap>j</KeyCap>
            <KeyCap>k</KeyCap>
            navigate
          </span>
          <span className="text-outline">·</span>
          <span className="flex items-center gap-1">
            <KeyCap>x</KeyCap>
            select
          </span>
          <span className="text-outline">·</span>
          <span className="flex items-center gap-1">
            <KeyCap>Enter</KeyCap>
            open finding
          </span>
        </p>
      )}

      <p className="text-center text-xs text-on-surface-variant">
        Signed off?{' '}
        <Link to="/summary" className="text-primary hover:underline">
          Open the executive summary
        </Link>
        .
      </p>
      </div>
    </div>
  )
}
