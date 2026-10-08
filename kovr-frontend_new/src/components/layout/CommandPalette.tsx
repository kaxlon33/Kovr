import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BookOpen,
  Bug,
  Cable,
  CornerDownLeft,
  History,
  ListChecks,
  Radar,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
} from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { KeyCap } from '@/components/ui/primitives'
import { useScanStore, openFindings } from '@/store/useScanStore'
import { displayTool, findingLocation, severityMeta } from '@/lib/format'
import { cn } from '@/lib/cn'

interface Command {
  id: string
  label: string
  hint?: string
  group: string
  icon: React.ComponentType<{ size?: number; className?: string }>
  run: () => void
  keywords?: string
}

function buildCommands({
  results,
  historyEntries,
  pipelineBusy,
  navigate,
  setOpen,
  loadScan,
  pushToast,
  refreshResults,
}: {
  results: ReturnType<typeof useScanStore.getState>['results']
  historyEntries: { scanId: string; repoUrl: string; score: number; openCount: number }[]
  pipelineBusy: boolean
  navigate: (to: string) => void
  setOpen: (open: boolean) => void
  loadScan: (scanId: string) => Promise<boolean>
  pushToast: ReturnType<typeof useScanStore.getState>['pushToast']
  refreshResults: () => Promise<void>
}): Command[] {
  const go = (to: string) => () => {
    navigate(to)
    setOpen(false)
  }

  const navigation: Command[] = [
    { id: 'nav-connect', label: 'Connect a repository', group: 'Navigate', icon: Cable, run: go('/connect') },
    { id: 'nav-scan', label: 'Go to live scan', group: 'Navigate', icon: Radar, run: go('/scan') },
    { id: 'nav-report', label: 'Go to findings', group: 'Navigate', icon: ListChecks, run: go('/report') },
    { id: 'nav-history', label: 'Session history', group: 'Navigate', icon: History, run: go('/history') },
    { id: 'nav-settings', label: 'Open settings', group: 'Navigate', icon: SettingsIcon, run: go('/settings') },
    { id: 'nav-docs', label: 'Open documentation', group: 'Navigate', icon: BookOpen, run: go('/docs') },
  ]

  const actions: Command[] =
    results && !pipelineBusy
      ? [
          {
            id: 'act-refresh',
            label: 'Refresh results from the backend',
            hint: results.scan_id,
            group: 'Actions',
            icon: RefreshCw,
            run: () => {
              void refreshResults()
              setOpen(false)
            },
          },
        ]
      : []

  const historyCommands: Command[] = historyEntries.slice(0, 8).map((entry) => ({
    id: `hist-${entry.scanId}`,
    label: entry.repoUrl,
    hint: `score ${entry.score} · ${entry.openCount} open`,
    group: 'Past scans',
    icon: History,
    keywords: entry.scanId,
    run: () => {
      void loadScan(entry.scanId).then((ok) => {
        if (ok) {
          navigate('/report')
        } else {
          pushToast({
            title: 'Could not open this scan',
            body: 'The backend could not serve its results (it may have been reset). Run a new scan.',
            tone: 'error',
          })
        }
      })
      setOpen(false)
    },
  }))

  const findingCommands: Command[] = openFindings(results)
    .slice(0, 40)
    .map((finding) => ({
      id: `finding-${finding.id}`,
      label: finding.title,
      hint: `${severityMeta(finding.severity).label} · ${findingLocation(finding)}`,
      group: 'Findings',
      icon: Bug,
      keywords: `${finding.pillar} ${displayTool(finding.tool)} ${finding.severity}`,
      run: go(`/findings/${finding.id}`),
    }))

  return [...navigation, ...actions, ...historyCommands, ...findingCommands]
}

export function CommandPalette() {
  // Thin shell: subscribes ONLY to open/close. A closed palette has zero
  // store subscriptions, so pipeline clicks (bulk approve, approve fix,
  // automatic fix) can never re-render — or crash — a hidden component.
  const open = useScanStore((s) => s.commandOpen)
  const setOpen = useScanStore((s) => s.setCommandOpen)
  if (!open) return null
  return <CommandPaletteContent setOpen={setOpen} />
}

function CommandPaletteContent({ setOpen }: { setOpen: (open: boolean) => void }) {
  const results = useScanStore((s) => s.results)
  const history = useScanStore((s) => s.history)
  const loadScan = useScanStore((s) => s.loadScan)
  const pushToast = useScanStore((s) => s.pushToast)
  const pipelineBusy =
    useScanStore((s) => s.bulkRunning) ||
    useScanStore((s) => s.fixing) ||
    useScanStore((s) => s.verifying)
  const refreshResults = useScanStore((s) => s.refreshResults)
  const navigate = useNavigate()

  // Defensive: persisted state from an older app version (or a hot-reload
  // edge case) can hand these back as undefined — never let that crash the
  // whole tree during a bulk run's re-renders.
  const historyEntries = Array.isArray(history) ? history : []
  if (!Array.isArray(history) && history !== undefined) {
    // eslint-disable-next-line no-console
    console.warn('[kovr] history had an unexpected shape:', typeof history)
  }

  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)

  const commands = useMemo<Command[]>(() => {
    try {
      return buildCommands({
        results,
        historyEntries,
        pipelineBusy,
        navigate,
        setOpen,
        loadScan,
        pushToast,
        refreshResults,
      })
    } catch (err) {
      // Degrade to navigation-only instead of unmounting the app — the
      // root ErrorBoundary stays as the last resort, not the first.
      // eslint-disable-next-line no-console
      console.error('[kovr] command palette failed to build commands:', err)
      return buildCommands({
        results: null,
        historyEntries: [],
        pipelineBusy,
        navigate,
        setOpen,
        loadScan,
        pushToast,
        refreshResults,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate, setOpen, results, history, loadScan, pushToast, refreshResults, pipelineBusy])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    const safeCommands = Array.isArray(commands) ? commands : []
    if (!q) return safeCommands.slice(0, 12)
    return safeCommands
      .filter((command) =>
        `${command.label} ${command.hint ?? ''} ${command.keywords ?? ''} ${command.group}`
          .toLowerCase()
          .includes(q),
      )
      .slice(0, 24)
  }, [commands, query])

  const matchList = matches ?? []

  useEffect(() => setCursor(0), [query])
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setCursor((c) => (c + 1) % Math.max(matchList.length, 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setCursor((c) => (c - 1 + matchList.length) % Math.max(matchList.length, 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      matchList[cursor]?.run()
    }
  }

  let lastGroup = ''

  return (
    <Modal open onClose={() => setOpen(false)} variant="plain" className="max-w-xl overflow-hidden p-0">
      <div className="flex items-center gap-3 border-b border-outline-variant px-4">
        <Search size={16} className="shrink-0 text-on-surface-variant" aria-hidden />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search findings, past scans, or run a command…"
          aria-label="Command palette search"
          className="h-12 w-full bg-transparent text-sm text-on-surface outline-none placeholder:text-on-surface-variant/60"
        />
      </div>

      {matchList.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-on-surface-variant">No matches for “{query}”.</p>
      ) : (
        <ul ref={listRef} className="max-h-80 overflow-y-auto py-2">
          {matchList.map((command, index) => {
            const showGroup = command.group !== lastGroup
            lastGroup = command.group
            const Icon = command.icon
            return (
              <li key={command.id}>
                {showGroup && (
                  <p className="px-4 pb-1 pt-3 text-[10px] font-medium uppercase tracking-wider text-outline">
                    {command.group}
                  </p>
                )}
                <button
                  data-active={index === cursor}
                  onMouseEnter={() => setCursor(index)}
                  onClick={command.run}
                  className={cn(
                    'flex w-full items-center gap-3 px-4 py-2 text-left transition-colors',
                    index === cursor ? 'bg-secondary-container' : 'hover:bg-surface-container-high',
                  )}
                >
                  <Icon size={16} className={index === cursor ? 'text-primary' : 'text-on-surface-variant'} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-on-surface">{command.label}</span>
                    {command.hint && (
                      <span className="block truncate font-mono text-[11px] text-on-surface-variant">
                        {command.hint}
                      </span>
                    )}
                  </span>
                  {index === cursor && <CornerDownLeft size={14} className="shrink-0 text-outline" />}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <div className="flex items-center justify-between border-t border-outline-variant px-4 py-2 text-[11px] text-on-surface-variant">
        <span className="flex items-center gap-1.5">
          <KeyCap>↑</KeyCap>
          <KeyCap>↓</KeyCap>
          to navigate
        </span>
        <span className="flex items-center gap-1.5">
          <KeyCap>Esc</KeyCap>
          to close
        </span>
      </div>
    </Modal>
  )
}
