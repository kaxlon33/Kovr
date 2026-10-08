import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ChevronDown, ChevronRight, CircleHelp, FolderOpen, LogOut, Menu, Search } from 'lucide-react'
import { IconButton } from '@/components/ui/Button'
import { KeyCap } from '@/components/ui/primitives'
import { LogoutConfirmModal } from '@/components/layout/LogoutButton'
import { useScanStore } from '@/store/useScanStore'
import { useAuthStore, selectIsAdmin } from '@/store/useAuthStore'
import { repoLabel } from '@/lib/format'
import { cn } from '@/lib/cn'

interface Crumb {
  label: string
  to?: string
}

function useCrumbs(): Crumb[] {
  const { pathname } = useLocation()
  const results = useScanStore((s) => s.results)
  const scanId = useScanStore((s) => s.scanId)

  const parts = pathname.split('/').filter(Boolean)
  const repo = results ? repoLabel(results.repo_url) : null

  if (parts.length === 0 || parts[0] === 'connect') return [{ label: 'Connect Repository' }]

  if (parts[0] === 'scan') {
    return [{ label: repo ?? 'Repository' }, { label: scanId ? `Scan ${scanId.slice(0, 8)}` : 'Live scan' }]
  }

  if (parts[0] === 'report') {
    return [{ label: repo ?? 'Repository' }, { label: 'Findings' }]
  }

  if (parts[0] === 'summary') {
    return [{ label: repo ?? 'Repository', to: '/report' }, { label: 'Summary' }]
  }

  if (parts[0] === 'findings') {
    const finding = results?.findings.find((f) => f.id === parts[1])
    return [
      { label: repo ?? 'Repository', to: '/report' },
      { label: 'Findings', to: '/report' },
      { label: parts[2] === 'verified' ? 'Resolution verified' : finding?.title ?? 'Finding' },
    ]
  }

  const labels: Record<string, string> = {
    history: 'Scan History',
    settings: 'Settings',
    docs: 'Documentation',
  }
  return [{ label: labels[parts[0]] ?? parts[0] }]
}

function initialsOf(email: string): string {
  const local = email.split('@')[0] ?? ''
  return (local.slice(0, 2) || '?').toUpperCase()
}

export function TopBar({ onOpenMenu }: { onOpenMenu?: () => void }) {
  const crumbs = useCrumbs()
  const setCommandOpen = useScanStore((s) => s.setCommandOpen)
  const setShortcutsOpen = useScanStore((s) => s.setShortcutsOpen)
  const developerMode = useScanStore((s) => s.settings.developerMode)
  const updateSettings = useScanStore((s) => s.updateSettings)
  const user = useAuthStore((s) => s.user)
  const isAdmin = useAuthStore(selectIsAdmin)
  const [menuOpen, setMenuOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  return (
    <header className="sticky top-0 z-40 flex h-16 w-full items-center justify-between gap-4 border-b border-outline-variant bg-surface-container px-4 md:px-6">
      <div className="flex min-w-0 items-center gap-2">
        {onOpenMenu && (
          <IconButton label="Open navigation" onClick={onOpenMenu} className="md:hidden">
            <Menu size={18} />
          </IconButton>
        )}

        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-sm">
          <FolderOpen size={16} className="hidden shrink-0 text-on-surface-variant sm:block" aria-hidden />
          {crumbs.map((crumb, index) => (
            <span key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-2">
              {index > 0 && <ChevronRight size={14} className="shrink-0 text-outline" aria-hidden />}
              {crumb.to && index < crumbs.length - 1 ? (
                <Link
                  to={crumb.to}
                  className="truncate text-on-surface-variant transition-colors hover:text-on-surface"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span
                  className={
                    index === crumbs.length - 1
                      ? 'truncate font-medium text-primary'
                      : 'truncate text-on-surface-variant'
                  }
                  aria-current={index === crumbs.length - 1 ? 'page' : undefined}
                >
                  {crumb.label}
                </span>
              )}
            </span>
          ))}
        </nav>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {developerMode && isAdmin && (
          <span
            title="Developer mode is on — raw payloads are visible"
            className="rounded-full border border-sev-info/40 bg-sev-info/10 px-2 py-0.5 font-mono text-[10px] font-semibold tracking-wider text-sev-info"
          >
            DEV
          </span>
        )}

        {user && (
          <div className="relative">
            {menuOpen && (
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} aria-hidden />
            )}

            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className={cn(
                'flex items-center gap-2 rounded-full border py-1 pl-1 pr-2.5 transition-colors',
                menuOpen ? 'border-primary/50' : 'border-outline-variant hover:border-primary/40',
              )}
            >
              <span
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-full border text-[11px] font-bold',
                  isAdmin
                    ? 'border-primary/40 bg-primary/15 text-primary'
                    : 'border-outline-variant bg-surface-container-lowest text-on-surface-variant',
                )}
              >
                {initialsOf(user.email)}
              </span>
              <span className="hidden max-w-36 truncate text-xs text-on-surface md:block">
                {user.email}
              </span>
              <ChevronDown
                size={13}
                className={cn('shrink-0 text-on-surface-variant transition-transform', menuOpen && 'rotate-180')}
              />
            </button>

            {menuOpen && (
              <div
                role="menu"
                className="animate-fade-up absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-xl border border-outline-variant bg-surface-container shadow-2xl shadow-black/50"
              >
                <div className="border-b border-outline-variant px-4 py-3">
                  <p className="truncate text-sm font-medium text-on-surface" title={user.email}>
                    {user.email}
                  </p>
                  <span
                    className={cn(
                      'mt-1.5 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide',
                      isAdmin
                        ? 'border-primary/40 bg-primary/10 text-primary'
                        : 'border-outline-variant text-on-surface-variant',
                    )}
                  >
                    {isAdmin ? 'ADMINISTRATOR' : 'USER'}
                  </span>
                </div>

                {isAdmin && (
                  <div className="flex items-center justify-between gap-3 border-b border-outline-variant px-4 py-2.5">
                    <span className="text-xs text-on-surface-variant">Developer mode</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={developerMode}
                      aria-label="Toggle developer mode"
                      onClick={() => updateSettings({ developerMode: !developerMode })}
                      className={cn(
                        'relative h-5 w-9 shrink-0 rounded-full border transition-colors duration-200',
                        developerMode
                          ? 'border-primary bg-primary'
                          : 'border-outline bg-surface-container-highest',
                      )}
                    >
                      <span
                        className={cn(
                          'absolute left-[2px] top-[2px] h-3.5 w-3.5 rounded-full transition-all duration-200',
                          developerMode ? 'translate-x-[16px] bg-on-primary' : 'translate-x-0 bg-outline',
                        )}
                      />
                    </button>
                  </div>
                )}

                <div className="p-2">
                  <button
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false)
                      setLoggingOut(true)
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-on-surface-variant transition-colors hover:bg-error/10 hover:text-error"
                  >
                    <LogOut size={14} />
                    Log out
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <button
          onClick={() => setCommandOpen(true)}
          className="hidden items-center gap-2 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-1.5 text-sm text-on-surface-variant transition-colors hover:border-outline hover:text-on-surface lg:flex"
        >
          <Search size={14} />
          <span>Search findings…</span>
          <KeyCap>Ctrl K</KeyCap>
        </button>

        <IconButton label="Search" onClick={() => setCommandOpen(true)} className="lg:hidden">
          <Search size={18} />
        </IconButton>

        <IconButton label="Keyboard shortcuts" onClick={() => setShortcutsOpen(true)}>
          <CircleHelp size={18} />
        </IconButton>
      </div>

      <LogoutConfirmModal open={loggingOut} onClose={() => setLoggingOut(false)} />
    </header>
  )
}
