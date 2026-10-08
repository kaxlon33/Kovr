import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { ArrowRight, ArrowUp, CheckCircle2, History, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/primitives'
import { useScanStore, openFindings } from '@/store/useScanStore'
import { scoreTone, friendlyVerifyReason } from '@/lib/format'

export function VerifyResolution() {
  const { findingId = '' } = useParams()
  const results = useScanStore((s) => s.results)
  const verifyResult = useScanStore((s) => s.verifyResult)
  const scoreBefore = useScanStore((s) => s.scoreBefore)
  const navigate = useNavigate()

  if (!results || !verifyResult) return <Navigate to="/report" replace />

  const resolved = verifyResult.verified === 'resolved'
  const before = scoreBefore ?? results.score
  const delta = results.score - before
  const remaining = openFindings(results).length

  return (
    <div className="flex flex-1 items-center justify-center p-6 md:p-8">
      <div className="animate-fade-up w-full max-w-2xl">
        <div className="mb-10 flex flex-col items-center text-center">
          <div
            className={`relative mb-6 flex h-20 w-20 items-center justify-center rounded-full border ${
              resolved ? 'border-tertiary/30 bg-tertiary/10' : 'border-sev-medium/30 bg-sev-medium/10'
            }`}
          >
            {resolved && (
              <span className="animate-pulse-ring absolute inset-0 scale-125 rounded-full border border-tertiary/20" />
            )}
            {resolved ? (
              <CheckCircle2 size={36} className="text-tertiary" />
            ) : (
              <TriangleAlert size={36} className="text-sev-medium" />
            )}
          </div>

          <h1 className="mb-3 text-4xl font-semibold tracking-tight text-on-surface">
            {resolved ? 'Finding resolved' : 'Still detected'}
          </h1>
          {verifyResult.reason && (
            <p className="max-w-md leading-relaxed text-on-surface-variant text-balance">
              {friendlyVerifyReason(verifyResult.reason)}
            </p>
          )}
        </div>

        <div className="mb-8 grid gap-4 sm:grid-cols-2">
          <Card className="relative overflow-hidden p-6">
            <div className="absolute inset-x-0 top-0 h-px bg-outline-variant" aria-hidden />
            <p className="mb-3 text-xs uppercase tracking-wider text-on-surface-variant">
              Previous Security Score
            </p>
            <p className="flex items-baseline gap-1">
              <span className="text-4xl font-bold tabular-nums text-on-surface-variant">{before}</span>
              <span className="text-sm text-outline">/100</span>
            </p>
            <p className="mt-3 flex items-center gap-1.5 text-xs text-on-surface-variant">
              <History size={13} />
              Before this fix
            </p>
          </Card>

          <Card className={`relative overflow-hidden p-6 ${resolved ? 'border-tertiary/30' : ''}`}>
            <div
              className={`absolute inset-x-0 top-0 h-px ${
                resolved ? 'bg-gradient-to-r from-transparent via-tertiary to-transparent' : 'bg-outline-variant'
              }`}
              aria-hidden
            />
            <p
              className={`mb-3 flex items-center gap-1.5 text-xs uppercase tracking-wider ${
                resolved ? 'text-tertiary' : 'text-on-surface-variant'
              }`}
            >
              {delta > 0 && <ArrowUp size={13} />}
              Updated Security Score
            </p>
            <p className="flex items-baseline gap-1">
              <span className={`text-4xl font-bold tabular-nums ${scoreTone(results.score)}`}>
                {results.score}
              </span>
              <span className="text-sm text-outline">/100</span>
            </p>
            <p className={`mt-3 text-xs font-medium ${delta > 0 ? 'text-tertiary' : 'text-on-surface-variant'}`}>
              {delta > 0 ? `+${delta} pts improvement` : delta < 0 ? `${delta} pts` : 'No score change'}
            </p>
          </Card>
        </div>

        <div className="flex flex-col justify-center gap-3 sm:flex-row">
          <Button variant="secondary" onClick={() => navigate(`/findings/${findingId}`)}>
            View diff log
          </Button>
          <Button
            variant="primary"
            trailing={<ArrowRight size={16} />}
            onClick={() => navigate(remaining > 0 ? '/report' : '/summary')}
          >
            {remaining > 0 ? 'Next finding' : 'Open summary'}
          </Button>
        </div>

        <p className="mt-6 text-center text-xs text-on-surface-variant">
          {remaining} finding{remaining === 1 ? '' : 's'} still open in this scan.
        </p>
      </div>
    </div>
  )
}
