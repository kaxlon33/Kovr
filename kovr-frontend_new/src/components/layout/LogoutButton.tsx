import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useAuthStore } from '@/store/useAuthStore'
import { useScanStore } from '@/store/useScanStore'
import { cn } from '@/lib/cn'

function initialsOf(email: string): string {
  const local = email.split('@')[0] ?? ''
  return (local.slice(0, 2) || '?').toUpperCase()
}

/**
 * Logout with confirmation — never a silent exit.
 *
 * When a fix/verification/bulk run is in flight, leaving would kill work
 * in progress: the user is warned and the run is PAUSED first. Idle users
 * get a simple "sure you want to leave?" check. Hover styling is red so
 * the destructive intent is obvious.
 */
export function LogoutConfirmModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const logout = useAuthStore((s) => s.logout)
  const user = useAuthStore((s) => s.user)
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin')
  const fixing = useScanStore((s) => s.fixing)
  const verifying = useScanStore((s) => s.verifying)
  const investigating = useScanStore((s) => s.investigating)
  const bulkRunning = useScanStore((s) => s.bulkRunning)
  const bulkPaused = useScanStore((s) => s.bulkPaused)
  const toggleBulkPause = useScanStore((s) => s.toggleBulkPause)

  const busy = fixing || verifying || Boolean(investigating) || bulkRunning

  const doLogout = () => {
    // Pause a running bulk pipeline before the session goes away.
    if (bulkRunning && !bulkPaused) toggleBulkPause()
    onClose()
    void logout().then(() => navigate('/login', { replace: true }))
  }

  return (
    <Modal open={open} onClose={onClose} variant="plain" className="max-w-sm overflow-hidden">
      <div className="relative flex flex-col items-center px-6 pb-6 pt-8 text-center">
        {/* Icon tile */}
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-error/40 bg-error/10">
          {busy ? (
            <span className="relative flex h-3.5 w-3.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sev-medium/60" aria-hidden />
              <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-sev-medium" aria-hidden />
            </span>
          ) : (
            <LogOut size={22} className="text-error" />
          )}
        </span>

        <h2 className="mt-4 text-lg font-semibold tracking-tight text-on-surface">
          {busy ? 'A fix is still in progress' : 'Log out?'}
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-on-surface-variant">
          {busy
            ? 'You are currently solving an issue — leaving pauses the process first.'
            : 'Are you sure you want to leave?'}
        </p>

        {/* Who is signing out */}
        {user && (
          <span className="mt-4 flex items-center gap-2 rounded-full border border-outline-variant bg-surface-container-lowest py-1 pl-1 pr-3">
            <span
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-full border text-[11px] font-bold',
                isAdmin
                  ? 'border-primary/40 bg-primary/15 text-primary'
                  : 'border-outline-variant bg-surface-container-low text-on-surface-variant',
              )}
            >
              {initialsOf(user.email)}
            </span>
            <span className="max-w-44 truncate text-xs text-on-surface">{user.email}</span>
          </span>
        )}

        {busy && (
          <p className="mt-4 w-full rounded-lg border border-sev-medium/25 bg-sev-medium/5 p-3 text-left text-xs leading-relaxed text-on-surface-variant">
            {bulkRunning
              ? 'The bulk run will be paused — your verified fixes stay committed. Resume by logging back in and reopening the scan.'
              : 'The fix being applied or verified right now will stop. Its finding stays open so you can approve it again later.'}
          </p>
        )}

        {!busy && (
          <p className="mt-4 text-[11px] leading-relaxed text-outline">
            Your scan history and settings stay saved on this device — sign back in anytime.
          </p>
        )}

        <div className="mt-6 flex w-full gap-2">
          <Button className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" className="flex-1" icon={<LogOut size={15} />} onClick={doLogout}>
            {bulkRunning && !bulkPaused ? 'Pause & log out' : 'Log out'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/** Button trigger + the confirm modal in one. */
export function LogoutButton({
  className,
  icon,
  children = 'Log out',
  variant = 'secondary',
  size,
}: {
  className?: string
  icon?: ReactNode
  children?: ReactNode
  variant?: 'primary' | 'secondary' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
}) {
  const [confirming, setConfirming] = useState(false)

  return (
    <>
      <Button
        variant={variant}
        size={size}
        icon={icon ?? <LogOut size={size === 'sm' ? 14 : 16} />}
        className={cn('hover:border-error/50 hover:bg-error/10 hover:text-error', className)}
        onClick={() => setConfirming(true)}
      >
        {children}
      </Button>
      <LogoutConfirmModal open={confirming} onClose={() => setConfirming(false)} />
    </>
  )
}
