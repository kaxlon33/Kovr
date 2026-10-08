import { useEffect, useState } from 'react'
import { fetchGithubStatus, getApiBase } from '@/api/client'
import type { GithubStatus } from '@/api/types'
import { GitHubMark } from '@/components/ui/GitHubMark'

/**
 * Shown on the main pages until the user connects their GitHub account.
 * Self-contained: loads its own status and renders nothing when connected
 * (or when the server has no OAuth app configured — that's the owner's
 * problem, not the user's).
 */
export function GitHubConnectBanner({ compact = false }: { compact?: boolean }) {
  const [status, setStatus] = useState<GithubStatus | null>(null)

  useEffect(() => {
    const load = () => fetchGithubStatus().then(setStatus).catch(() => setStatus(null))
    load()
    // The OAuth flow opens in its own tab; when the user comes back here
    // the banner must disappear without a manual reload.
    window.addEventListener('focus', load)
    return () => window.removeEventListener('focus', load)
  }, [])

  if (!status || status.connected || !status.oauth_configured) return null

  return (
    <div
      className={
        compact
          ? 'flex flex-wrap items-center gap-2.5 rounded-xl border border-primary/30 bg-primary/5 px-3.5 py-2.5'
          : 'flex flex-wrap items-center gap-3 rounded-xl border border-primary/40 bg-primary/5 px-4 py-3.5 shadow-[0_0_24px_-14px_rgba(34,211,238,0.4)]'
      }
    >
      <GitHubMark size={compact ? 16 : 20} className="shrink-0 text-primary" />
      <p className="min-w-0 flex-1 text-xs leading-relaxed text-on-surface-variant">
        Connect GitHub once — then your verified fixes can be sent straight to your repositories as
        pull requests.
      </p>
      <a
        href={`${getApiBase()}/api/github/connect`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-primary bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary transition-colors hover:bg-primary-dim"
      >
        <GitHubMark size={13} />
        Connect GitHub
      </a>
    </div>
  )
}
