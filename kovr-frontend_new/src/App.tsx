import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useEffect, type ReactNode } from 'react'
import { LoaderCircle, RefreshCw, RotateCw, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { AppShell } from '@/components/layout/AppShell'
import { Connect } from '@/pages/Connect'
import { Docs } from '@/pages/Docs'
import { FindingDetail } from '@/pages/FindingDetail'
import { Login } from '@/pages/Login'
import { Register } from '@/pages/Register'
import { Report } from '@/pages/Report'
import { ScanProgress } from '@/pages/ScanProgress'
import { ScanSetup } from '@/pages/ScanSetup'
import { SessionHistory } from '@/pages/SessionHistory'
import { Settings } from '@/pages/Settings'
import { Summary } from '@/pages/Summary'
import { VerifyResolution } from '@/pages/VerifyResolution'
import { useAuthStore } from '@/store/useAuthStore'

function NotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="font-mono text-5xl font-bold text-outline">404</p>
      <p className="text-on-surface-variant">That route does not exist.</p>
      <Link to="/connect" className="text-sm text-primary hover:underline">
        Back to Connect
      </Link>
    </div>
  )
}

/**
 * Blocks the app behind authentication. Renders nothing until checkAuth
 * has resolved, so a valid cookie restored on reload is not bounced to
 * the login screen mid-flight. An unreachable backend is NEVER treated
 * as a logout — the user gets a retry screen instead.
 */
function RequireAuth({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user)
  const authChecked = useAuthStore((s) => s.authChecked)
  const authUnavailable = useAuthStore((s) => s.authUnavailable)
  const checkAuth = useAuthStore((s) => s.checkAuth)
  const location = useLocation()

  if (!authChecked) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background">
        <p className="text-sm text-on-surface-variant">Restoring session…</p>
      </div>
    )
  }

  if (authUnavailable) {
    return (
      <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background p-8 text-center">
        {/* Layered backdrop — dot field, twin glows, a slow page-wide sweep */}
        <div className="bg-dot-grid pointer-events-none absolute inset-0 opacity-15" aria-hidden />
        <div
          className="pointer-events-none absolute -left-48 -top-48 h-150 w-150 rounded-full opacity-25 blur-3xl"
          style={{ background: 'radial-gradient(circle, #22d3ee 0%, transparent 70%)' }}
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-52 -right-40 h-150 w-150 rounded-full opacity-15 blur-3xl"
          style={{ background: 'radial-gradient(circle, #34d399 0%, transparent 70%)' }}
          aria-hidden
        />
        <div className="pointer-events-none absolute inset-x-0 top-[18%] h-px overflow-hidden" aria-hidden>
          <div className="animate-scan-sweep h-px w-1/3 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        </div>

        {/* Instrument radar — dual counter-rotating sweeps, live blips */}
        <div className="relative mb-10 h-48 w-48" aria-hidden>
          <div className="absolute inset-0 rounded-full border border-outline-variant/70" />
          <div className="absolute inset-5 rounded-full border border-outline-variant/50" />
          <div className="absolute inset-10 rounded-full border border-outline-variant/30" />
          <div className="absolute left-1/2 top-0 h-full w-px bg-outline-variant/25" />
          <div className="absolute left-0 top-1/2 h-px w-full bg-outline-variant/25" />
          <div
            className="absolute inset-0 animate-spin rounded-full opacity-70 [animation-duration:6s]"
            style={{
              background:
                'conic-gradient(from 0deg, rgba(34,211,238,0.55), rgba(34,211,238,0.08) 60deg, transparent 90deg)',
            }}
          />
          <div
            className="absolute inset-6 animate-spin rounded-full opacity-25 [animation-direction:reverse] [animation-duration:9s]"
            style={{ background: 'conic-gradient(from 180deg, rgba(52,211,153,0.45), transparent 70deg)' }}
          />
          <div className="absolute inset-[38%] animate-ping rounded-full border border-primary/40" />
          <div className="absolute inset-[44%] rounded-full bg-primary/85 shadow-[0_0_26px_5px_rgba(34,211,238,0.4)]" />
          <span className="absolute left-[30%] top-[26%] h-1.5 w-1.5 animate-pulse rounded-full bg-tertiary [animation-delay:400ms]" />
          <span className="absolute left-[66%] top-[58%] h-1.5 w-1.5 animate-pulse rounded-full bg-sev-medium [animation-delay:1300ms]" />
          <span className="absolute left-[44%] top-[73%] h-1 w-1 animate-pulse rounded-full bg-primary/70 [animation-delay:2100ms]" />
        </div>

        <p className="font-mono text-sm font-bold tracking-tight text-on-surface">KOVR</p>

        <span className="mt-4 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[11px] font-medium tracking-wide text-primary">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" aria-hidden />
          Backend unreachable
        </span>

        <h1 className="mt-5 text-4xl font-semibold tracking-tight text-on-surface">
          Reconnecting<span className="animate-blink">…</span>
        </h1>
        <p className="mt-3 max-w-sm text-sm leading-relaxed text-on-surface-variant">
          The server isn&apos;t responding at the moment. We keep trying for you — nothing is lost,
          and you haven&apos;t been signed out.
        </p>

        <div className="mt-6 inline-flex items-center gap-2 rounded-lg border border-outline-variant bg-surface-container/60 px-3 py-1.5 font-mono text-[10px] tracking-widest text-on-surface-variant">
          <LoaderCircle size={11} className="animate-spin text-primary" aria-hidden />
          AUTO-RETRY EVERY 5S
        </div>

        <div className="mt-7 flex items-center gap-3">
          <Button variant="primary" icon={<RefreshCw size={14} />} onClick={() => void checkAuth()}>
            Try now
          </Button>
          <Button variant="secondary" icon={<RotateCw size={14} />} onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>

        <p className="absolute bottom-6 flex items-center gap-1.5 text-[10px] text-outline">
          <ShieldCheck size={11} aria-hidden />
          Your work is saved — this usually resolves itself in a few seconds
        </p>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  }

  return <>{children}</>
}

export default function App() {
  const checkAuth = useAuthStore((s) => s.checkAuth)
  const authUnavailable = useAuthStore((s) => s.authUnavailable)

  // Session restore must run HERE, at the top of the tree — not inside
  // AppShell, which only mounts after the guard has already resolved.
  // Otherwise the guard waits on a call that can never fire.
  useEffect(() => {
    void checkAuth()
  }, [checkAuth])

  // The unreachable-server state self-heals: retry quietly in the
  // background so the user returns to the app without pressing anything.
  useEffect(() => {
    if (!authUnavailable) return
    const timer = setInterval(() => void checkAuth(), 5000)
    return () => clearInterval(timer)
  }, [authUnavailable, checkAuth])

  return (
    <Routes>
      {/* Chromeless public routes */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/connect" replace />} />
        <Route path="connect" element={<Connect />} />
        <Route path="scan-setup" element={<ScanSetup />} />
        <Route path="scan" element={<ScanProgress />} />
        <Route path="report" element={<Report />} />
        <Route path="summary" element={<Summary />} />
        <Route path="findings/:findingId" element={<FindingDetail />} />
        <Route path="findings/:findingId/verified" element={<VerifyResolution />} />
        <Route path="history" element={<SessionHistory />} />
        <Route path="settings" element={<Settings />} />
        <Route path="docs" element={<Docs />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
