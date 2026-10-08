import { NavLink } from 'react-router-dom'
import { BookOpen, Cable, History, ListChecks, Radar, Settings as SettingsIcon, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useScanStore, openFindings } from '@/store/useScanStore'

function navClass({ isActive }: { isActive: boolean }) {
  return cn(
    'flex items-center gap-3 rounded-lg px-4 py-2 text-sm transition-colors',
    isActive
      ? 'bg-secondary-container text-primary font-medium'
      : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface',
  )
}

export function SideNav({ onNavigate }: { onNavigate?: () => void }) {
  const results = useScanStore((s) => s.results)
  const progress = useScanStore((s) => s.progress)
  const historyCount = useScanStore((s) => s.history?.length ?? 0)

  const scanning = Object.keys(progress).length > 0 && !progress.complete
  const open = openFindings(results).length

  return (
    <nav className="flex h-full w-64 flex-col border-r border-outline-variant bg-surface">
      <div className="flex items-center gap-3 border-b border-outline-variant px-6 py-6">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/10">
          <ShieldCheck size={19} className="text-primary" />
        </div>
        <div className="min-w-0">
          <h1 className="font-mono text-sm font-bold tracking-tight text-on-surface">KOVR</h1>
          <p className="text-[10px] uppercase tracking-wider text-outline">AI security scanner</p>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-6">
        <NavLink to="/connect" className={navClass} onClick={onNavigate}>
          <Cable size={18} />
          <span>Connect</span>
        </NavLink>

        <NavLink to="/scan" className={navClass} onClick={onNavigate}>
          <Radar size={18} />
          <span>Scan</span>
          {scanning && (
            <span className="ml-auto flex items-center gap-1.5 text-[10px] font-mono text-primary">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
              live
            </span>
          )}
        </NavLink>

        <NavLink to="/report" className={navClass} onClick={onNavigate}>
          <ListChecks size={18} />
          <span>Findings</span>
          {open > 0 && (
            <span className="ml-auto font-mono text-[10px] text-on-surface-variant">{open}</span>
          )}
        </NavLink>

        <NavLink to="/history" className={navClass} onClick={onNavigate}>
          <History size={18} />
          <span>History</span>
          {historyCount > 0 && (
            <span className="ml-auto font-mono text-[10px] text-on-surface-variant">{historyCount}</span>
          )}
        </NavLink>
      </div>

      <div className="flex flex-col gap-1 border-t border-outline-variant px-3 py-6">
        <NavLink to="/settings" className={navClass} onClick={onNavigate}>
          <SettingsIcon size={18} />
          <span>Settings</span>
        </NavLink>
        <NavLink to="/docs" className={navClass} onClick={onNavigate}>
          <BookOpen size={18} />
          <span>Documentation</span>
        </NavLink>
      </div>
    </nav>
  )
}
