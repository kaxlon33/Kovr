import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { X } from 'lucide-react'
import { SideNav } from '@/components/layout/SideNav'
import { TopBar } from '@/components/layout/TopBar'
import { CommandPalette } from '@/components/layout/CommandPalette'
import { ShortcutsDialog } from '@/components/layout/ShortcutsDialog'
import { DevPanel } from '@/components/layout/DevPanel'
import { Toaster } from '@/components/ui/Toaster'
import { IconButton } from '@/components/ui/Button'
import { useGlobalHotkeys } from '@/hooks/useGlobalHotkeys'
import { useScanStore } from '@/store/useScanStore'
import { activeBucketKey } from '@/lib/perUserStorage'
import { cn } from '@/lib/cn'

export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false)
  const { pathname } = useLocation()
  const settings = useScanStore((s) => s.settings)
  const restoreScan = useScanStore((s) => s.restoreScan)
  useGlobalHotkeys()

  // Connect is a chromeless landing page for EVERYONE — no top bar, no
  // sidebar, not even for admins. Navigation away happens by starting a
  // scan (Ctrl+K opens the command palette from here).
  const isConnect = pathname === '/connect'
  const showSidebar = !isConnect

  // A reload keeps the scan id but no findings — re-read them from the backend.
  useEffect(() => {
    void restoreScan()
  }, [restoreScan])

  // Cross-tab convergence: when another tab writes this account's bucket
  // (cleared history, new scan), re-read it here. Without this, a dormant
  // tab keeps stale history in memory and its next action would write it
  // back, resurrecting deleted entries. Skipped mid-scan, where swapping
  // the scan id under a live run corrupts it.
  useEffect(() => {
    const bucket = activeBucketKey('kovr-frontend')
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== bucket) return
      const s = useScanStore.getState()
      if (s.loading || s.fixing || s.verifying || s.bulkRunning || s.investigating) return
      void useScanStore.persist.rehydrate()
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // Each route starts at the top, and the mobile drawer closes behind you.
  useEffect(() => {
    setMenuOpen(false)
    window.scrollTo({ top: 0 })
  }, [pathname])

  useEffect(() => {
    document.documentElement.dataset.density = settings.density
    document.documentElement.dataset.motion = settings.motion
  }, [settings.density, settings.motion])

  return (
    <div className="flex min-h-screen bg-background">
      {showSidebar && (
        <div className="fixed left-0 top-0 z-50 hidden h-screen md:block">
          <SideNav />
        </div>
      )}

      {menuOpen && showSidebar && (
        <div className="fixed inset-0 z-100 md:hidden">
          <div
            className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            onClick={() => setMenuOpen(false)}
            aria-hidden
          />
          <div className="animate-slide-in relative h-full w-64">
            <SideNav onNavigate={() => setMenuOpen(false)} />
            <IconButton
              label="Close navigation"
              onClick={() => setMenuOpen(false)}
              className="absolute -right-11 top-4"
            >
              <X size={18} />
            </IconButton>
          </div>
        </div>
      )}

      <div className={cn('flex min-h-screen min-w-0 flex-1 flex-col', showSidebar && 'md:pl-64')}>
        {!isConnect && <TopBar onOpenMenu={() => setMenuOpen(true)} />}
        <main className="flex flex-1 flex-col">
          <Outlet />
        </main>
      </div>

      <CommandPalette />
      <ShortcutsDialog />
      <DevPanel />
      <Toaster />
    </div>
  )
}
