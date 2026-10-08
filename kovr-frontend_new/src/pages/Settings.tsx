import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CheckCircle2, CircleAlert, CircleUserRound, RotateCcw, Terminal, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, Input, SectionLabel, Select, Switch } from '@/components/ui/primitives'
import { GitHubMark } from '@/components/ui/GitHubMark'
import { useScanStore } from '@/store/useScanStore'
import { useAuthStore, selectIsAdmin } from '@/store/useAuthStore'
import { DEFAULT_API_BASE, disconnectGithub, fetchGithubStatus, getApiBase, setApiBase } from '@/api/client'
import { LogoutButton } from '@/components/layout/LogoutButton'
import { cn } from '@/lib/cn'

// The OAuth callback lands on /settings?github=<code> — map each code to a
// message a user can actually act on instead of a raw query param.
const GITHUB_RESULTS: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: 'GitHub connected — you can open pull requests now.' },
  denied: { ok: false, text: 'Authorization was cancelled on GitHub — try again when ready.' },
  state_expired: {
    ok: false,
    text: 'The connection request expired (valid for 10 minutes) — try again.',
  },
  not_configured: {
    ok: false,
    text: 'This server has no GitHub OAuth app configured — ask the instance owner.',
  },
  failed: { ok: false, text: 'GitHub did not return an access token — try again in a moment.' },
}

function initialsOf(email: string): string {
  const local = email.split('@')[0] ?? ''
  return (local.slice(0, 2) || '?').toUpperCase()
}

export function Settings() {
  const [searchParams] = useSearchParams()
  const settings = useScanStore((s) => s.settings)
  const updateSettings = useScanStore((s) => s.updateSettings)
  const fetchPrStatus = useScanStore((s) => s.fetchPrStatus)
  const user = useAuthStore((s) => s.user)
  const isAdmin = useAuthStore(selectIsAdmin)
  const [apiBase, setApiBaseState] = useState(getApiBase())
  const [github, setGithub] = useState<{ connected: boolean; oauth_configured: boolean } | null>(null)

  const githubResult = searchParams.get('github')
  const githubMessage = githubResult ? GITHUB_RESULTS[githubResult] : undefined

  const refreshGithub = () => {
    fetchGithubStatus().then(setGithub).catch(() => setGithub(null))
  }

  useEffect(() => {
    refreshGithub()
  }, [githubResult])

  // The OAuth flow opens in its own tab; when the user returns to this one
  // the card must notice the connection without a manual reload.
  useEffect(() => {
    window.addEventListener('focus', refreshGithub)
    return () => window.removeEventListener('focus', refreshGithub)
  }, [])

  useEffect(() => {
    if (githubResult === 'connected') {
      // The OAuth callback stores the token, then lands here — refresh PR
      // state so the Open Pull Request button enables immediately.
      const scanId = useScanStore.getState().scanId
      if (scanId) void fetchPrStatus(scanId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [githubResult])

  const changeApiBase = (value: string) => {
    setApiBaseState(value)
    setApiBase(value)
  }

  const resetApiBase = () => changeApiBase(DEFAULT_API_BASE)

  return (
    <div className="animate-fade-up mx-auto w-full max-w-3xl space-y-8 p-6 md:p-8">
      <header className="border-b border-outline-variant pb-6">
        <h1 className="mb-2 text-4xl font-semibold tracking-tight text-on-surface">Settings</h1>
        <p className="text-sm text-on-surface-variant">
          Account and interface preferences. Preferences are stored locally in this browser.
        </p>
      </header>

      {/* Account — who is signed in sits at the top */}
      <section>
        <SectionLabel className="mb-3">Account</SectionLabel>
        <Card className="flex flex-wrap items-center gap-4 p-5">
          <span
            className={cn(
              'flex h-11 w-11 shrink-0 items-center justify-center rounded-full border text-sm font-bold',
              isAdmin
                ? 'border-primary/40 bg-primary/15 text-primary'
                : 'border-outline-variant bg-surface-container-lowest text-on-surface-variant',
            )}
          >
            {user ? initialsOf(user.email) : <CircleUserRound size={20} />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-on-surface" title={user?.email}>
              {user?.email ?? 'Not signed in'}
            </p>
            <span
              className={cn(
                'mt-1 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide',
                isAdmin
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-outline-variant text-on-surface-variant',
              )}
            >
              {isAdmin ? 'ADMINISTRATOR' : 'USER'}
            </span>
          </div>
          {user && <LogoutButton variant="secondary" />}
        </Card>
      </section>

      {/* GitHub connection — pull requests open under the user's own
          account, so this stays near the top but below the account. */}
      <section>
        <SectionLabel className="mb-3">GitHub</SectionLabel>
        <Card
          className={cn(
            'relative p-5',
            !github?.connected &&
              github?.oauth_configured !== false &&
              'border-primary/40 bg-primary/5 shadow-[0_0_24px_-12px_rgba(34,211,238,0.35)]',
          )}
        >
          {!github?.connected && (
            <div
              className="absolute left-0 top-0 h-px w-full bg-gradient-to-r from-transparent via-primary/50 to-transparent"
              aria-hidden
            />
          )}
          <div className="flex flex-wrap items-center gap-4">
            <span
              className={cn(
                'flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border',
                github?.connected
                  ? 'border-tertiary/40 bg-tertiary/10 text-tertiary'
                  : 'border-primary/30 bg-primary/10 text-primary',
              )}
            >
              <GitHubMark size={24} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-on-surface">
                {github?.connected ? 'GitHub account connected' : 'Connect your GitHub account'}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">
                {github?.connected
                  ? 'Verified fixes can be pushed and pull requests opened under your own GitHub account.'
                  : github?.oauth_configured === false
                    ? 'The server has no GitHub OAuth app configured yet — ask the instance owner.'
                    : 'Required to open pull requests — connect once and KOVR sends your verified fixes straight to your repositories.'}
              </p>
            </div>
            {github?.connected && (
              <button
                type="button"
                onClick={() => void disconnectGithub().then(refreshGithub)}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-outline-variant px-3 text-xs font-medium text-on-surface-variant transition-colors hover:border-error/50 hover:bg-error/10 hover:text-error active:scale-[0.98]"
              >
                <X size={14} />
                Disconnect
              </button>
            )}
            {!github?.connected && (
              <Button
                variant="primary"
                size="sm"
                icon={<GitHubMark size={14} />}
                disabled={!github || !github.oauth_configured}
                onClick={() =>
                  window.open(`${getApiBase()}/api/github/connect`, '_blank', 'noopener,noreferrer')
                }
              >
                Connect GitHub
              </Button>
            )}
          </div>
          {githubMessage && (
            <p
              className={cn(
                'mt-4 flex items-center gap-2 text-xs font-medium',
                githubMessage.ok ? 'text-tertiary' : 'text-sev-medium',
              )}
            >
              {githubMessage.ok ? (
                <CheckCircle2 size={13} aria-hidden />
              ) : (
                <CircleAlert size={13} aria-hidden />
              )}
              {githubMessage.text}
            </p>
          )}
        </Card>
      </section>

      {/* Interface */}
      <section>
        <SectionLabel className="mb-3">Interface</SectionLabel>
        <Card className="divide-y divide-outline-variant px-5">
          <div className="flex items-center justify-between gap-6 py-4">
            <div>
              <p className="text-sm text-on-surface">Row density</p>
              <p className="mt-0.5 text-xs text-on-surface-variant">
                Compact fits roughly a third more findings on screen.
              </p>
            </div>
            <Select
              aria-label="Row density"
              value={settings.density}
              onChange={(event) =>
                updateSettings({ density: event.target.value as 'compact' | 'comfortable' })
              }
            >
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </Select>
          </div>

          <Switch
            label="Interface animation"
            description="Turn off to freeze scan sweeps and transitions. Your system reduced-motion setting is always honoured."
            checked={settings.motion === 'on'}
            onChange={(on) => updateSettings({ motion: on ? 'on' : 'off' })}
          />

          <Switch
            label="Scan notifications"
            description="Show an OS notification when a scan finishes while you're in another tab."
            checked={settings.notifications}
            onChange={(on) => updateSettings({ notifications: on })}
          />

          {isAdmin && (
            <>
              <Switch
                label="Developer mode"
                description="Reveal raw finding payloads, investigation JSON and endpoint data. Intended for debugging the pipeline, not for everyday use."
                checked={Boolean(settings.developerMode)}
                onChange={(on) => updateSettings({ developerMode: on })}
              />

              {Boolean(settings.developerMode) && (
                <div className="py-4">
                  <p className="mb-3 flex items-center gap-2 text-sm font-medium text-on-surface">
                    <Terminal size={15} className="text-primary" />
                    Backend API base URL
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      aria-label="Backend API base URL"
                      value={apiBase}
                      onChange={(event) => changeApiBase(event.target.value)}
                      placeholder={DEFAULT_API_BASE}
                      spellCheck={false}
                      className="min-w-0 flex-1 font-mono text-xs"
                    />
                    <Button size="sm" icon={<RotateCcw size={13} />} onClick={resetApiBase}>
                      Reset
                    </Button>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-on-surface-variant">
                    Applies immediately to every request — stored in this browser only, never sent
                    anywhere. Point it at a different backend port or a deployed instance to test
                    against it.
                  </p>
                </div>
              )}
            </>
          )}
        </Card>
      </section>
    </div>
  )
}
