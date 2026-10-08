import { useEffect, useState } from 'react'
import { fetchGithubStatus } from '@/api/client'
import type { GithubStatus } from '@/api/types'

/**
 * Current user's GitHub connection state. Loads on mount and re-checks on
 * window focus, so pages react to connect/disconnect happening elsewhere
 * (the OAuth flow runs in its own tab; disconnect happens in Settings —
 * navigating back re-mounts the page and re-checks).
 */
export function useGithubStatus(): GithubStatus | null {
  const [status, setStatus] = useState<GithubStatus | null>(null)

  useEffect(() => {
    const load = () => fetchGithubStatus().then(setStatus).catch(() => setStatus(null))
    load()
    window.addEventListener('focus', load)
    return () => window.removeEventListener('focus', load)
  }, [])

  return status
}
