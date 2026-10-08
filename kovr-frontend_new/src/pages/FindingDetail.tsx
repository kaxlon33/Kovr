import { useEffect } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  CircleAlert,
  FolderClosed,
  LoaderCircle,
  Route,
  ShieldAlert,
  Sparkles,
  Wrench,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, SectionLabel, Skeleton } from '@/components/ui/primitives'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { DevJson } from '@/components/ui/DevJson'
import { RestoringScan } from '@/components/layout/RestoringScan'
import { CodeDiff, SeverityBadge, pillarLabel } from '@/components/findings/FindingBits'
import { useScanStore } from '@/store/useScanStore'
import { cleanPath, displayTool, findingLocation, friendlyVerifyReason } from '@/lib/format'

export function FindingDetail() {
  const { findingId = '' } = useParams()
  const results = useScanStore((s) => s.results)
  const restoring = useScanStore((s) => s.restoring)
  const restorableScanId = useScanStore((s) => s.scanId)
  const investigations = useScanStore((s) => s.investigations)
  const investigating = useScanStore((s) => s.investigating)
  const fixing = useScanStore((s) => s.fixing)
  const verifying = useScanStore((s) => s.verifying)
  const fixResult = useScanStore((s) => s.fixResult)
  const error = useScanStore((s) => s.error)
  const setError = useScanStore((s) => s.setError)
    const investigateFinding = useScanStore((s) => s.investigateFinding)
  const approveFix = useScanStore((s) => s.approveFix)
  const rejectFix = useScanStore((s) => s.rejectFix)
  const clearFindingState = useScanStore((s) => s.clearFindingState)
  const developerMode = useScanStore((s) => s.settings.developerMode)
  const setLastViewedFinding = useScanStore((s) => s.setLastViewedFinding)
  const investigationNotice = useScanStore((s) => s.investigationNotice)
  const navigate = useNavigate()

  const finding = results?.findings.find((f) => f.id === findingId)
  const investigation = investigations[findingId]

  // Opening a finding kicks off GET /api/finding/{id}/investigate and marks
  // it as the last viewed, so the findings list can highlight it on return.
  // Codebase-wide findings are split server-side during investigation — the
  // user is redirected to the (pre-selected) instances.
  useEffect(() => {
    clearFindingState()
    setLastViewedFinding(findingId)
    const cached = investigations[findingId]
    if (finding && (!cached || (cached as any).parse_error)) {
      void investigateFinding(findingId).then((expanded) => {
        if (expanded) navigate('/report')
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findingId])

  // A reload arrives with the scan id but no findings yet — wait for the re-read.
  if (!results) {
    return restoring || restorableScanId ? <RestoringScan /> : <Navigate to="/connect" replace />
  }

  if (!finding) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
        <p className="text-on-surface-variant">That finding is no longer in the current scan.</p>
        <Button onClick={() => navigate('/report')}>Back to findings</Button>
      </div>
    )
  }

  const busy = investigating === findingId

  const onApprove = async () => {
    const verifyData = await approveFix(finding.id)
    if (verifyData) navigate(`/findings/${finding.id}/verified`)
  }

    const onReject = async () => {
    await rejectFix(finding.id)
    navigate('/report')
  }

  return (
    <div className="animate-fade-up mx-auto w-full max-w-6xl space-y-6 p-6 md:p-8">
      <Link
        to="/report"
        className="inline-flex items-center gap-2 text-sm text-on-surface-variant transition-colors hover:text-on-surface"
      >
        <ArrowLeft size={15} />
        Back to findings
      </Link>

      <header className="border-b border-outline-variant pb-6">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <SeverityBadge severity={finding.severity} />
          <span className="rounded-md border border-primary/25 bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
            {pillarLabel(finding.pillar)}
          </span>
          {displayTool(finding.tool) && (
            <span className="rounded-md border border-outline-variant px-2 py-1 font-mono text-xs text-on-surface-variant">
              {displayTool(finding.tool)}
            </span>
          )}
          {finding.verified === 'resolved' && (
            <span className="rounded-md border border-tertiary/30 px-2 py-1 text-xs font-medium text-tertiary">
              Resolved
            </span>
          )}
        </div>

        <h1 className="mb-3 text-4xl font-semibold tracking-tight text-on-surface text-balance">
          {finding.title}
        </h1>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-on-surface-variant">
          <span className="flex items-center gap-1.5 font-mono">
            <FolderClosed size={14} />
            {findingLocation(finding)}
          </span>
        </div>
      </header>

      {error && <ErrorBanner message={error} onDismiss={() => setError('')} />}

      {finding.description && (
        <Card className="p-6">
          <SectionLabel className="mb-3">Detected issue</SectionLabel>
          <p className="leading-relaxed text-on-surface-variant">{finding.description}</p>
        </Card>
      )}

      {busy && (
        <Card className="p-6">
          <p className="mb-1 flex items-center gap-2 text-sm text-primary">
            <LoaderCircle size={15} className="animate-spin" />
            Preparing the suggested fix…
          </p>
          <p className="mb-4 text-xs leading-relaxed text-on-surface-variant">
            Reading the affected code and drafting a before/after patch for this one finding —
            your repository is not being re-scanned. Findings you've opened before load instantly.
          </p>
          <div className="space-y-3">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-28 w-full" />
          </div>
        </Card>
      )}

      {/* A retry that couldn't regenerate must say WHY — never just bring
          the button back in silence. */}
      {investigationNotice?.findingId === findingId && !busy && (
        <Card
          className={
            investigationNotice.quota
              ? 'border-sev-info/30 bg-sev-info/5 p-5'
              : 'border-sev-medium/30 bg-sev-medium/5 p-5'
          }
        >
          {investigationNotice.quota ? (
            <>
              <p className="flex items-center gap-2 text-sm font-semibold text-sev-info">
                <CircleAlert size={15} aria-hidden />
                AI limit reached — fix not regenerated
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-on-surface-variant">
                The AI quota is used up right now, so "Try automatic fix again" couldn't generate a
                new patch. Nothing is broken: you can retry once the quota resets (per-minute
                limits clear in seconds; the daily quota within about 24 hours). The suggestion
                below is unchanged.
              </p>
            </>
          ) : (
            <>
              <p className="flex items-center gap-2 text-sm font-semibold text-sev-medium">
                <CircleAlert size={15} aria-hidden />
                Fix generation failed
              </p>
              <p className="mt-1.5 break-words text-xs leading-relaxed text-on-surface-variant">
                {investigationNotice.message}
              </p>
            </>
          )}
        </Card>
      )}

      {/* Failed verification, explained — the retry loop regenerates the
          suggestion, so users must know why the code differs and why it
          failed. Never a bare "Auto-fix failed" again. */}
      {finding.verified === 'failed' && (
        <Card className="border-sev-medium/30 bg-sev-medium/5 p-5">
          <p className="flex items-center gap-2 text-sm font-semibold text-sev-medium">
            <CircleAlert size={15} aria-hidden />
            Automatic fix not confirmed
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-on-surface-variant">
            {friendlyVerifyReason(finding.last_verify_reason)} Review the suggestion below — apply
            it manually if it looks right, or approve again to retry.
          </p>
          {developerMode && finding.last_verify_reason && (
            <p className="mt-3 rounded-lg border border-sev-medium/25 bg-surface-container-lowest p-3 font-mono text-[11px] leading-relaxed text-on-surface-variant">
              Verifier said: {finding.last_verify_reason}
            </p>
          )}
        </Card>
      )}

      {investigation?.parse_error && (
        <ErrorBanner message="The AI's response couldn't be read for this finding. Open it again to retry." />
      )}

      {investigation && !investigation.parse_error && (
        <>
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              {investigation.root_cause && (
                <Card className="p-6">
                  <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-on-surface">
                    <Sparkles size={18} className="text-primary" />
                    Root Cause
                  </h2>
                  <p className="leading-relaxed text-on-surface-variant">{investigation.root_cause}</p>
                </Card>
              )}

              {investigation.attack_path && (
                <Card className="p-6">
                  <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-on-surface">
                    <Route size={18} className="text-primary" />
                    Attack Path
                  </h2>
                  <p className="leading-relaxed text-on-surface-variant">{investigation.attack_path}</p>
                </Card>
              )}
            </div>

            <div className="space-y-6">
              {investigation.impact && (
                <Card className="p-6">
                  <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-on-surface">
                    <ShieldAlert size={18} className="text-error" />
                    Impact
                  </h2>
                  <p className="flex gap-2.5 text-sm leading-relaxed text-on-surface-variant">
                    <X size={15} className="mt-0.5 shrink-0 text-error" aria-hidden />
                    {investigation.impact}
                  </p>
                </Card>
              )}

              <Card className="p-6">
                <SectionLabel className="mb-4">Metadata</SectionLabel>
                <dl className="space-y-3 text-sm">
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-on-surface-variant">Pillar</dt>
                    <dd className="text-right text-on-surface">{pillarLabel(finding.pillar)}</dd>
                  </div>
                  {displayTool(finding.tool) && (
                    <div className="flex items-start justify-between gap-4">
                      <dt className="text-on-surface-variant">Tool</dt>
                      <dd className="text-right font-mono text-on-surface">
                        {displayTool(finding.tool)}
                      </dd>
                    </div>
                  )}
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-on-surface-variant">File</dt>
                    <dd className="min-w-0 break-all text-right font-mono text-xs text-on-surface">
                      {cleanPath(finding.file)}
                    </dd>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-on-surface-variant">Line</dt>
                    <dd className="text-right font-mono text-on-surface">{finding.line ?? '—'}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-on-surface-variant">Finding id</dt>
                    <dd className="min-w-0 break-all text-right font-mono text-xs text-on-surface-variant">
                      {finding.id}
                    </dd>
                  </div>
                  {developerMode && (
                    <>
                      <div className="flex items-start justify-between gap-4">
                        <dt className="text-on-surface-variant">Scope</dt>
                        <dd className="text-right font-mono text-xs text-on-surface">
                          {finding.scope ?? 'local'}
                        </dd>
                      </div>
                      <div className="flex items-start justify-between gap-4">
                        <dt className="text-on-surface-variant">Verified</dt>
                        <dd className="text-right font-mono text-xs text-on-surface">
                          {finding.verified ?? 'pending'}
                        </dd>
                      </div>
                      <div className="flex items-start justify-between gap-4">
                        <dt className="text-on-surface-variant">Investigation source</dt>
                        <dd className="text-right font-mono text-xs text-on-surface">
                          {(investigation as { source?: string })?.source ?? 'live'}
                        </dd>
                      </div>
                    </>
                  )}
                </dl>
              </Card>
            </div>
          </div>

          {investigation.fix_explanation && (
            <Card className="p-6">
              <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-on-surface">
                <Wrench size={18} className="text-primary" />
                Suggested Fix
              </h2>
              <p className="mb-5 leading-relaxed text-on-surface-variant">{investigation.fix_explanation}</p>
              <CodeDiff
                before={investigation.before_code || ''}
                after={investigation.after_code || ''}
                file={cleanPath(investigation.file || finding.file)}
              />
            </Card>
          )}

          {developerMode && (
            <section className="space-y-4">
              <SectionLabel>Developer data</SectionLabel>
              <DevJson title={`finding ${finding.id}`} data={finding} />
              <DevJson
                title={`GET /api/finding/${finding.id}/investigate`}
                data={investigation}
              />
            </section>
          )}

          {fixResult?.status === 'recorded' && (
            <p className="text-sm text-on-surface-variant">Fix rejected.</p>
          )}
          {fixResult?.status === 'failed' && (
            <ErrorBanner message={`Fix failed: ${fixResult.error ?? 'unknown error'}`} />
          )}

          <footer className="flex flex-col gap-3 border-t border-outline-variant pt-6 sm:flex-row sm:justify-end">
            {verifying && (
              <span className="flex items-center gap-2 self-center text-sm text-primary">
                <LoaderCircle size={15} className="animate-spin" />
                Re-scanning to verify the fix…
              </span>
            )}

              {finding.verified === 'failed' ? (
              <>
                <Button variant="secondary" icon={<Ban size={16} />} disabled={fixing} onClick={onReject}>
                  Reject
                </Button>
                <Button
                  variant="primary"
                  icon={<CheckCircle2 size={16} />}
                  disabled={fixing}
                  onClick={onApprove}
                >
                  {fixing ? 'Applying…' : 'Approve fix'}
                </Button>
              </>
            ) : (
              <>
                <Button variant="secondary" icon={<Ban size={16} />} disabled={fixing} onClick={onReject}>
                  Reject
                </Button>
                <Button
                  variant="primary"
                  icon={<CheckCircle2 size={16} />}
                  disabled={fixing}
                  onClick={onApprove}
                >
                  {fixing ? 'Applying…' : 'Approve fix'}
                </Button>
              </>
            )}
          </footer>
        </>
      )}
    </div>
  )
}
