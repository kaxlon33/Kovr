import { useEffect } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Boxes,
  CheckCircle2,
  Download,
  GitPullRequestArrow,
  Network,
  Share2,
  ShieldCheck,
  SquareDashedBottomCode,
  TriangleAlert,
} from 'lucide-react'
import { PILLAR_KEYS, PILLAR_LABELS, type PillarKey } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { Card, ProgressBar, SectionLabel } from '@/components/ui/primitives'
import { ScoreRing } from '@/components/viz/ScoreRing'
import { RestoringScan } from '@/components/layout/RestoringScan'
import { useScanStore, openFindings } from '@/store/useScanStore'
import { useGithubStatus } from '@/hooks/useGithubStatus'
import { bucketCounts, repoLabel, scoreVerdict } from '@/lib/format'
import { exportMarkdown } from '@/lib/export'
import { cn } from '@/lib/cn'

const PILLAR_ICON: Record<PillarKey, typeof ShieldCheck> = {
  security: ShieldCheck,
  api_design: Network,
  backend_logic: Boxes,
  ui_ux: SquareDashedBottomCode,
}

export function Summary() {
  const results = useScanStore((s) => s.results)
  const restoring = useScanStore((s) => s.restoring)
  const restorableScanId = useScanStore((s) => s.scanId)
  const investigations = useScanStore((s) => s.investigations)
  const bulkProgress = useScanStore((s) => s.bulkProgress)
  const pushToast = useScanStore((s) => s.pushToast)
  const prStatus = useScanStore((s) => s.prStatus)
  const prLoading = useScanStore((s) => s.prLoading)
  const fetchPrStatus = useScanStore((s) => s.fetchPrStatus)
  const openPullRequest = useScanStore((s) => s.openPullRequest)
  const navigate = useNavigate()

  useEffect(() => {
    if (results?.scan_id) void fetchPrStatus(results.scan_id)
  }, [results?.scan_id, fetchPrStatus])

  // A reload arrives with the scan id but no findings yet — wait for the re-read.
  if (!results) {
    return restoring || restorableScanId ? <RestoringScan /> : <Navigate to="/connect" replace />
  }

  const open = openFindings(results)
  const github = useGithubStatus()
  const resolved = results.findings.length - open.length
  const counts = bucketCounts(open)
  const allClear = counts.highCritical === 0

  const share = async () => {
    const url = window.location.href
    try {
      if (navigator.share) {
        await navigator.share({ title: `KOVR report — ${repoLabel(results.repo_url)}`, url })
        return
      }
      await navigator.clipboard.writeText(url)
      pushToast({ title: 'Report link copied', body: url, tone: 'success' })
    } catch {
      pushToast({ title: 'Could not share this report', tone: 'warn' })
    }
  }

  return (
    <div className="animate-fade-up mx-auto w-full max-w-6xl space-y-6 p-6 md:p-8">
      <Card className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute right-0 top-0 h-full w-2/3 opacity-[0.07]"
          style={{
            background: `radial-gradient(ellipse at top right, ${allClear ? '#34d399' : '#ef4444'}, transparent 65%)`,
          }}
          aria-hidden
        />

        <div className="relative flex flex-col items-start gap-8 p-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-xl">
            <span
              className={cn(
                'mb-6 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-wider',
                allClear
                  ? 'border-tertiary/30 bg-tertiary/10 text-tertiary'
                  : 'border-error/30 bg-error/10 text-error',
              )}
            >
              {allClear ? <CheckCircle2 size={14} /> : <TriangleAlert size={14} />}
              {allClear ? 'Audit complete' : 'Action required'}
            </span>

            <h1 className="mb-4 text-4xl font-bold tracking-tight text-on-surface md:text-5xl">
              {allClear ? 'System Secured.' : 'Remediation Pending.'}
            </h1>

            <p className="mb-8 leading-relaxed text-on-surface-variant text-balance">
              {allClear
                ? `No high or critical findings remain in ${repoLabel(results.repo_url)}. ${resolved} of ${results.findings.length} issues have been handled.`
                : `${counts.highCritical} high-impact findings are still open in ${repoLabel(results.repo_url)}. Clear them before promoting this branch.`}
            </p>

            <div className="flex flex-wrap gap-3">
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
                  title={`Push ${prStatus.commit_count} verified fix${prStatus.commit_count === 1 ? '' : 'es'} and open a pull request under your GitHub account`}
                  onClick={() => void openPullRequest()}
                >
                  {prLoading ? 'Opening…' : 'Open Pull Request'}
                </Button>
              ) : null}
              <Button
                variant={prStatus?.pr_url || prStatus?.commit_count ? 'secondary' : 'primary'}
                icon={<Download size={16} />}
                onClick={() => exportMarkdown(results, investigations)}
              >
                Download Report
              </Button>
              <Button icon={<Share2 size={16} />} onClick={share}>
                Share
              </Button>
              <Button
                variant="secondary"
                icon={<ArrowLeft size={16} />}
                onClick={() => navigate('/report')}
              >
                Back to findings
              </Button>
            </div>
          </div>

          <div className="flex w-full flex-col items-center rounded-xl border border-outline-variant bg-surface-container-lowest p-8 lg:w-auto">
            <ScoreRing score={results.score} size={200} thickness={4} showGrade />
            <p className="mt-4 text-xs uppercase tracking-wider text-on-surface-variant">
              {scoreVerdict(results.score)}
            </p>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {PILLAR_KEYS.map((key) => {
          const Icon = PILLAR_ICON[key]
          const forPillar = results.findings.filter((f) => f.pillar === key)
          const fixed = forPillar.filter((f) => f.verified === 'resolved').length
          const stillOpen = forPillar.length - fixed
          const pct = forPillar.length === 0 ? 100 : (fixed / forPillar.length) * 100

          return (
            <Card key={key} className="p-5">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl border border-primary/30 bg-primary/10">
                <Icon size={18} className="text-primary" />
              </div>
              <h3 className="text-sm font-medium text-on-surface">{PILLAR_LABELS[key]}</h3>
              <p className="mt-1 mb-4">
                <span className="text-3xl font-bold tabular-nums text-on-surface">{fixed}</span>
                <span className="ml-1.5 text-sm text-on-surface-variant">fixed</span>
              </p>
              <div className="flex items-center justify-between text-xs">
                <span className="text-on-surface-variant">Remaining</span>
                <span className={stillOpen === 0 ? 'text-tertiary' : 'text-sev-medium'}>
                  {stillOpen === 0 ? 'none' : `${stillOpen} open`}
                </span>
              </div>
              <ProgressBar
                value={pct}
                tone={stillOpen === 0 ? 'success' : 'primary'}
                label={`${PILLAR_LABELS[key]} remediation`}
                className="mt-2"
              />
            </Card>
          )
        })}
      </div>

      <section>
        <SectionLabel className="mb-3">Verification log</SectionLabel>
        <div className="overflow-x-auto rounded-xl border border-outline-variant bg-surface-container-lowest p-6 font-mono text-xs leading-loose">
          <div className="text-primary">&gt;&gt; Verification sequence for {results.scan_id}</div>
          {PILLAR_KEYS.map((key) => {
            const forPillar = results.findings.filter((f) => f.pillar === key)
            const stillOpen = forPillar.filter((f) => f.verified !== 'resolved').length
            return (
              <div key={key} className={stillOpen === 0 ? 'text-tertiary' : 'text-sev-medium'}>
                [{stillOpen === 0 ? 'OK' : '!!'}] {PILLAR_LABELS[key]}: {forPillar.length} checked,{' '}
                {stillOpen} open
              </div>
            )
          })}
          <div className={counts.highCritical === 0 ? 'text-tertiary' : 'text-error'}>
            [{counts.highCritical === 0 ? 'OK' : '!!'}] High &amp; critical: {counts.highCritical} outstanding
          </div>
          {Object.keys(bulkProgress).length > 0 && (
            <div className="text-on-surface-variant">
              [--] Bulk run: {Object.values(bulkProgress).filter((v) => v === 'resolved').length} auto-fixed,{' '}
              {Object.values(bulkProgress).filter((v) => v === 'failed').length} auto-fix failed,{' '}
              {Object.values(bulkProgress).filter((v) => v === 'ai_limit').length} ai-limit,{' '}
              {Object.values(bulkProgress).filter((v) => v === 'skipped').length} not applicable
            </div>
          )}
          <div className="mt-2 text-primary">
            &gt;&gt; {resolved} of {results.findings.length} findings resolved · readiness{' '}
            {allClear ? 'optimal' : 'blocked'}
          </div>
        </div>
      </section>
    </div>
  )
}
