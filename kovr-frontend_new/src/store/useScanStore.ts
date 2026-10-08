import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  Finding,
  FixResult,
  Investigation,
  PillarKey,
  PrStatus,
  ProgressState,
  ScanResults,
  VerifyResult,
} from '@/api/types'
import { PILLAR_KEYS } from '@/api/types'
import * as api from '@/api/client'
import { requestNotificationPermission, notifyScanComplete } from '@/lib/notify'
import { repoLabel } from '@/lib/format'
import { perUserStorage, purgeLegacyBuckets } from '@/lib/perUserStorage'

/** Status labels for the bulk pipeline — same keys the original frontend used. */
export type BulkStatus =
  | 'pending'
  | 'investigating'
  | 'fixing'
  | 'verifying'
  | 'resolved'
  | 'failed'
  | 'skipped'
  | 'codebase_wide'
  | 'ai_limit'

export interface SessionScan {
  scanId: string
  repoUrl: string
  score: number
  findingCount: number
  openCount: number
  at: string
}

export interface Toast {
  id: string
  title: string
  body?: string
  tone: 'info' | 'success' | 'warn' | 'error'
}

export interface UiSettings {
  density: 'compact' | 'comfortable'
  motion: 'on' | 'off'
  /** OS-level notification when a scan finishes in a background tab. */
  notifications: boolean
  /** Reveals raw payloads, ids and endpoint data across the UI. */
  developerMode: boolean
}

interface ScanState {
  /* ── server state ─────────────────────────────────────────────── */
  repoUrl: string
  loading: boolean
  error: string
  scanId: string
  progress: ProgressState
  results: ScanResults | null

  /* ── per-finding investigation ────────────────────────────────── */
  investigations: Record<string, Investigation>
  investigating: string | null
  /** Outcome of the LAST investigation attempt that returned an error —
   * surfaced inline on the finding page so retries never fail silently. */
  investigationNotice: { findingId: string; quota: boolean; message: string } | null
  fixing: boolean
  verifying: boolean
  /** The finding currently being investigated/fixed — powers the
   * "jump back to it" affordance while a new scan is blocked. */
  activeFindingId: string | null
  /** The finding whose detail was opened last — highlighted when the
   * user returns to the findings list so they can see what they clicked. */
  lastViewedFindingId: string | null
  /* ── pull-request lifecycle ───────────────────────────────────── */
  prStatus: PrStatus | null
  prLoading: boolean
  /** Active severity bucket on the findings list. Lives in the store so a
   * round-trip into a finding detail and back keeps the filter applied. */
  severityFilter: 'all' | 'highCritical' | 'warnings' | 'info'
  fixResult: FixResult | null
  verifyResult: VerifyResult | null
  /** Score captured before an approve, so the verify screen can show the delta. */
  scoreBefore: number | null

  /* ── bulk pipeline ────────────────────────────────────────────── */
  selectedIds: string[]
  bulkRunning: boolean
  bulkPaused: boolean
  bulkProgress: Record<string, BulkStatus>
  /** Human note set when the backend reports the AI quota is exhausted. */
  quotaNote: string

  /* ── frontend-only extras ─────────────────────────────────────── */
  /** True while a reloaded page is re-reading its scan from the backend. */
  restoring: boolean
  /** Server-side pause flag for the running scan (SSE-synced). */
  scanPaused: boolean
  /** True while the cancel request is in flight. */
  cancellingScan: boolean
  /** Which analyzers the user chose for this scan (setup page). */
  selectedPillars: PillarKey[]
  history: SessionScan[]
  toasts: Toast[]
  settings: UiSettings
  commandOpen: boolean
  shortcutsOpen: boolean
  /** Developer diagnostics panel — only reachable in developer mode. */
  devPanelOpen: boolean

  /* ── actions ──────────────────────────────────────────────────── */
  setRepoUrl: (url: string) => void
  setError: (error: string) => void
  startScan: () => Promise<string | null>
  loadScan: (scanId: string) => Promise<boolean>
  refreshResults: () => Promise<void>
  stopStream: () => void
  /** Server-side scan control: Pause/Resume hold the run at a safe point,
   * Cancel aborts it, discards everything, and returns to Connect. Pause
   * resolves true only when the server confirmed the hold. */
  pauseScan: () => Promise<boolean>
  resumeScan: () => Promise<void>
  togglePillar: (key: PillarKey) => void
  cancelScan: () => Promise<void>
  /** Local-only reset for an orphaned scan (backend restarted mid-run). */
  resetScan: () => void

  /** Investigate a finding; resolves true when the finding was codebase-wide
   * and got auto-split (the caller should leave the detail page). */
  investigateFinding: (findingId: string, refresh?: boolean) => Promise<boolean>
  approveFix: (findingId: string) => Promise<VerifyResult | null>
  rejectFix: (findingId: string) => Promise<void>
  expandFinding: (findingId: string) => Promise<boolean>
  clearFindingState: () => void

  toggleSelect: (id: string) => void
  selectBySeverity: (severities: string[]) => void
  clearSelection: () => void
  runBulkApprove: () => Promise<void>
  toggleBulkPause: () => void
  retryFinding: (id: string) => Promise<void>

  pushToast: (toast: Omit<Toast, 'id'>) => void
  dismissToast: (id: string) => void
  updateSettings: (patch: Partial<UiSettings>) => void
  setCommandOpen: (open: boolean) => void
  setShortcutsOpen: (open: boolean) => void
  setDevPanelOpen: (open: boolean) => void
  setLastViewedFinding: (id: string | null) => void
  setSeverityFilter: (filter: 'all' | 'highCritical' | 'warnings' | 'info') => void
  fetchPrStatus: (scanId: string) => Promise<void>
  openPullRequest: () => Promise<void>
  clearHistory: () => Promise<void>
  removeHistoryEntry: (scanId: string) => void
  restoreScan: () => Promise<void>
}

let eventSource: EventSource | null = null
let toastSeq = 0

/** Open findings are everything the backend has not marked resolved. */
export function openFindings(results: ScanResults | null): Finding[] {
  return results?.findings?.filter((f) => f.verified !== 'resolved') ?? []
}

export const useScanStore = create<ScanState>()(
  persist(
    (set, get) => ({
      repoUrl: '',
      loading: false,
      error: '',
      scanId: '',
      progress: {},
      results: null,

      investigations: {},
      investigating: null,
      investigationNotice: null,
      fixing: false,
      verifying: false,
      activeFindingId: null,
      lastViewedFindingId: null,
      prStatus: null,
      prLoading: false,
      severityFilter: 'all',
      fixResult: null,
      verifyResult: null,
      scoreBefore: null,

      selectedIds: [],
      bulkRunning: false,
      bulkPaused: false,
      bulkProgress: {},
      quotaNote: '',

      restoring: false,
      /** Server-side pause flag for the running scan (SSE-synced). */
      scanPaused: false,
      /** True while the cancel request is in flight. */
      cancellingScan: false,
      selectedPillars: [...PILLAR_KEYS],
      history: [],
      toasts: [],
      settings: { density: 'comfortable', motion: 'on', notifications: true, developerMode: false },
      commandOpen: false,
      shortcutsOpen: false,
      devPanelOpen: false,

      setRepoUrl: (repoUrl) => set({ repoUrl, error: '' }),
      setError: (error) => set({ error }),

      togglePillar: (key) =>
        set((state) => ({
          selectedPillars: state.selectedPillars.includes(key)
            ? state.selectedPillars.filter((k) => k !== key)
            : [...state.selectedPillars, key],
        })),

      stopStream: () => {
        eventSource?.close()
        eventSource = null
      },

      pauseScan: async () => {
        const scanId = get().scanId
        if (!scanId) return false
        try {
          await api.setScanPaused(scanId, true)
          set({ scanPaused: true })
          return true
        } catch (err) {
          get().pushToast({
            title: 'Could not pause',
            body: err instanceof Error ? err.message : 'The server did not accept the pause request.',
            tone: 'error',
          })
          return false
        }
      },

      resumeScan: async () => {
        const scanId = get().scanId
        if (!scanId) return
        try {
          await api.setScanPaused(scanId, false)
          set({ scanPaused: false })
        } catch (err) {
          get().pushToast({
            title: 'Could not resume',
            body: err instanceof Error ? err.message : 'The server did not accept the resume request.',
            tone: 'error',
          })
        }
      },

      cancelScan: async () => {
        const scanId = get().scanId
        if (!scanId || get().cancellingScan) return
        set({ cancellingScan: true })
        try {
          await api.cancelScan(scanId).catch(() => null)
        } finally {
          // Whether or not the server heard us, this scan is over locally:
          // stop the stream, drop the local id, and clean up server-side
          // (the backend also removes the clone on cooperative cancel).
          get().stopStream()
          void api.deleteScan(scanId).catch(() => null)
          set({
            progress: {},
            scanId: '',
            results: null,
            loading: false,
            scanPaused: false,
            cancellingScan: false,
          })
        }
      },

      resetScan: () => {
        get().stopStream()
        set({
          progress: {},
          scanId: '',
          results: null,
          loading: false,
          scanPaused: false,
          cancellingScan: false,
        })
      },

      /**
       * POST /api/clone → POST /api/scan/{id}/start → subscribe to the SSE
       * stream. Exactly the original sequence, including its error strings.
       */
      startScan: async () => {
        // A fix, verification or investigation writes to the backend's
        // cloned repo and finding rows — starting a new scan mid-flight
        // can corrupt that work, so refuse with a clear message.
        const { fixing, verifying, bulkRunning, investigating } = get()
        if (fixing || verifying || bulkRunning || investigating) {
          set({ error: 'A fix is in progress — wait for it to finish before starting a new scan.' })
          return null
        }

        const repoUrl = get().repoUrl
        if (!repoUrl.trim()) {
          set({ error: 'Please enter a GitHub repo URL' })
          return null
        }

        get().stopStream()
        if (get().settings.notifications) requestNotificationPermission()
        set({
          loading: true,
          error: '',
          progress: {},
          scanId: '',
          results: null,
          investigations: {},
          selectedIds: [],
          bulkProgress: {},
          scanPaused: false,
          cancellingScan: false,
          // Nothing from the previous repo's report may leak into the new
          // run — selection, open finding, PR state and filters all reset.
          activeFindingId: null,
          lastViewedFindingId: null,
          fixResult: null,
          verifyResult: null,
          investigationNotice: null,
          prStatus: null,
          scoreBefore: null,
          severityFilter: 'all',
        })

          try {
          const cloneData = await api.clone(repoUrl)
          if ((cloneData as any).error) {
            set({ error: (cloneData as any).error })
            return null
          }
          set({ scanId: cloneData.scan_id })

          const startData = await api.startScan(cloneData.scan_id, repoUrl, get().selectedPillars)
          if (startData.error) {
            // e.g. concurrency cap hit — show why instead of navigating
            // into a progress page for a scan that will never run.
            void api.deleteScan(cloneData.scan_id).catch(() => null)
            set({ error: startData.error, loading: false, scanId: '' })
            return null
          }

          const es = api.openScanStream(cloneData.scan_id)
          eventSource = es

                    es.onmessage = (event) => {
            const data: ProgressState = JSON.parse(event.data)
            set({ progress: data, scanPaused: Boolean(data.paused) })

            if (data.complete) {
              es.close()
              eventSource = null
              void get().loadScan(cloneData.scan_id).then(() => {
                const results = get().results
                if (results && get().settings.notifications) {
                  const issueCount = openFindings(results).length
                  notifyScanComplete(repoLabel(results.repo_url), results.score, issueCount)
                }
              })
            }
          }

          es.onerror = () => {
            es.close()
            eventSource = null
          }

          return cloneData.scan_id
        } catch (err) {
          set({ error: err instanceof Error ? err.message : 'Something went wrong' })
          return null
        } finally {
          set({ loading: false })
        }
      },

      /* GET /api/scan/{id}/results, then record the run in local history.
         Resolves false (and sets error) when the backend can't serve the
         scan, so callers can avoid navigating into a report that would
         spin forever waiting for results that never arrive. */
      loadScan: async (scanId) => {
        try {
          const data = await api.fetchResults(scanId)

          /* The backend answers { error } until the scan row exists. */
          if (!data || (data as any).error || !Array.isArray(data.findings)) {
            const message = (data as any)?.error as string | undefined
            if (message === 'Scan not found') {
              // Gone server-side (deleted by a clear/cancel, or a stale
              // entry from before a data reset). Self-heal: drop it from
              // history so it stops appearing in every list.
              set((state) => ({ history: state.history.filter((h) => h.scanId !== scanId) }))
              set({ error: 'This scan no longer exists on the server.' })
            } else {
              set({ error: message ?? 'Results are not ready yet' })
            }
            return false
          }

          const open = data.findings.filter((f) => f.verified !== 'resolved').length

          set((state) => {
            const entry: SessionScan = {
              scanId: data.scan_id,
              repoUrl: data.repo_url,
              score: data.score,
              findingCount: data.findings.length,
              openCount: open,
              at: new Date().toISOString(),
            }
            const existing = state.history.find((h) => h.scanId === data.scan_id)
            const history = existing
              ? state.history.map((h) => (h.scanId === data.scan_id ? { ...entry, at: h.at } : h))
              : [entry, ...state.history].slice(0, 30)
            return { results: data, scanId: data.scan_id, history }
          })
          return true
        } catch (err) {
          set({ error: err instanceof Error ? err.message : 'Failed to load results' })
          return false
        }
      },

      refreshResults: async () => {
        const scanId = get().scanId
        if (scanId) await get().loadScan(scanId)
      },

      /**
       * After a reload only the scan id survives, so read its results back.
       * If the backend no longer knows the scan, drop the id and let the app
       * fall back to the Connect screen.
       */
      restoreScan: async () => {
        const { scanId, results } = get()
        if (!scanId || results) return
        set({ restoring: true })
        try {
          await get().loadScan(scanId)
          if (!get().results) set({ scanId: '' })
        } finally {
          set({ restoring: false })
        }
      },

      /* GET /api/finding/{id}/investigate — refresh=true regenerates the fix */
      investigateFinding: async (findingId, refresh = false) => {
        set({
          investigating: findingId,
          fixResult: null,
          verifyResult: null,
          activeFindingId: findingId,
          investigationNotice: null,
        })
        try {
          const data = await api.investigate(findingId, refresh)

          /* Codebase-wide findings split automatically server-side —
           * select the new instances and point the user at bulk approve
           * instead of showing an unfixable umbrella finding. */
          if ((data as { status?: string }).status === 'expanded') {
            const newIds = (data as { new_finding_ids?: string[] }).new_finding_ids ?? []
            await get().refreshResults()
            if (newIds.length > 0) {
              set({ selectedIds: newIds })
              get().pushToast({
                title: `Split into ${newIds.length} fixable finding${newIds.length === 1 ? '' : 's'}`,
                body: "They're selected and ready — press Bulk approve on the findings page.",
                tone: 'success',
              })
            }
            return true
          }

          if (data.error) {
            set({
              error: data.error,
              investigationNotice: {
                findingId,
                quota: (data as { error_type?: string }).error_type === 'quota_exceeded',
                message: data.error,
              },
            })
          } else {
            set((state) => ({ investigations: { ...state.investigations, [findingId]: data } }))
          }
        } catch (err) {
          set({ error: err instanceof Error ? err.message : 'Failed to investigate finding' })
        } finally {
          set({ investigating: null, activeFindingId: null })
        }
        return false
      },

      /* POST fix(approve) → POST verify → re-read results on resolution. */
      approveFix: async (findingId) => {
        set({ fixing: true, error: '', scoreBefore: get().results?.score ?? null, activeFindingId: findingId })
        try {
          const data = await api.applyFix(findingId, 'approve')
          set({ fixResult: data })

          if (data.status === 'fix_applied') {
            set({ verifying: true })
            const verifyData = await api.verifyFix(findingId)
            set({ verifyResult: verifyData, verifying: false })

            if (verifyData.verified === 'resolved') {
              await get().refreshResults()
              get().pushToast({ title: 'Finding resolved', body: verifyData.reason, tone: 'success' })
            } else {
              get().pushToast({
                title: 'Still detected after the fix',
                body: verifyData.reason,
                tone: 'warn',
              })
            }
            return verifyData
          }

          if (data.status === 'failed') {
            get().pushToast({ title: 'Fix failed', body: data.error, tone: 'error' })
          }
          return null
        } catch (err) {
          set({ error: err instanceof Error ? err.message : 'Failed to apply fix' })
          return null
        } finally {
          set({ fixing: false, verifying: false, activeFindingId: null })
        }
      },

            /* POST fix(reject) — the finding drops out of the local list. */
      rejectFix: async (findingId) => {
        set({ fixing: true, error: '', activeFindingId: findingId })
        try {
          await api.applyFix(findingId, 'reject')
          set((state) => ({
            results: state.results
              ? { ...state.results, findings: state.results.findings.filter((f) => f.id !== findingId) }
              : state.results,
          }))
          get().pushToast({ title: 'Fix rejected', tone: 'info' })
        } catch (err) {
          set({ error: err instanceof Error ? err.message : 'Failed to reject fix' })
        } finally {
          set({ fixing: false, activeFindingId: null })
        }
      },

      /* POST expand — turns a codebase_wide finding into separate fixable
         local findings, one per affected file. Refreshes results so the
         new findings appear in the list. */
      expandFinding: async (findingId) => {
        set({ fixing: true, error: '', activeFindingId: findingId })
        try {
          const data = await api.expandFinding(findingId)
          if (data.error) {
            set({ error: data.error })
            return false
          }
          await get().refreshResults()
          const newIds = data.new_finding_ids ?? []
          const count = newIds.length

          // Pre-select the split instances so the very next action is one
          // click: Bulk approve. No hunting through the list required.
          if (count > 0) {
            set({ selectedIds: newIds })
          }

          get().pushToast({
            title: `Found ${count} location${count === 1 ? '' : 's'} with this issue`,
            body:
              count > 0
                ? "They're selected and ready on the findings page — press Bulk approve to fix them all."
                : 'No additional affected files were found.',
            tone: 'success',
          })
          return true
        } catch (err) {
          set({ error: err instanceof Error ? err.message : 'Failed to expand finding' })
          return false
        } finally {
          set({ fixing: false, activeFindingId: null })
        }
      },

      clearFindingState: () =>
        set({ fixResult: null, verifyResult: null, error: '', investigationNotice: null }),

      toggleSelect: (id) =>
        set((state) => ({
          selectedIds: state.selectedIds.includes(id)
            ? state.selectedIds.filter((existing) => existing !== id)
            : [...state.selectedIds, id],
        })),

      selectBySeverity: (severities) => {
        const results = get().results
        if (!results) return
        const matching = results.findings.filter(
          (f) => f.verified !== 'resolved' && severities.includes(f.severity?.toLowerCase()),
        )
        // Every issue in this group already fixed and verified — say so
        // instead of silently selecting nothing.
        if (matching.length === 0) {
          get().pushToast({
            title: 'All related issues are already solved',
            body: 'Every finding in this severity group has been fixed and verified — try solving the groups that are left.',
            tone: 'success',
          })
        }
        set({ selectedIds: matching.map((f) => f.id) })
      },

      clearSelection: () => set({ selectedIds: [] }),

      /**
       * investigate → fix → verify, one finding at a time, exactly as the
       * original bulk routine ran it (including the skip and failure rules).
       */
      runBulkApprove: async () => {
        const ids = [...(get().selectedIds ?? [])]
        if (ids.length === 0) return

        set({
          bulkRunning: true,
          bulkPaused: false,
          bulkProgress: Object.fromEntries(ids.map((id) => [id, 'pending' as BulkStatus])),
          quotaNote: '',
        })

        try {
          for (const id of ids) {
            // Pause takes effect between findings — the finding currently in
            // flight always finishes so no AI call is left half-done.
            while (get().bulkPaused) {
              await new Promise((resolve) => setTimeout(resolve, 250))
            }

            await processFinding(id, set)

            // Pace bulk AI calls, in short slices so Pause responds quickly.
            for (let i = 0; i < 10 && !get().bulkPaused; i++) {
              await new Promise((resolve) => setTimeout(resolve, 200))
            }
          }
        } finally {
          // Whatever happens mid-run, never leave the pipeline flagged as
          // running — that would lock Refresh and the bulk controls forever.
          set({ bulkRunning: false, bulkPaused: false, selectedIds: [], activeFindingId: null })
        }

        await get().refreshResults()

        const values = Object.values(get().bulkProgress)
        const fixed = values.filter((v) => v === 'resolved').length
        get().pushToast({
          title: `${fixed} of ${values.length} issues fixed automatically`,
          tone: fixed === values.length ? 'success' : 'info',
        })
      },

      toggleBulkPause: () =>
        set((state) => ({ bulkPaused: state.bulkRunning ? !state.bulkPaused : false })),

      retryFinding: async (id) => {
        await processFinding(id, set)
        await get().refreshResults()
        set({ activeFindingId: null })
      },

      pushToast: (toast) => {
        toastSeq += 1
        const id = `t${toastSeq}`
        set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }))
        setTimeout(() => get().dismissToast(id), 5600)
      },

      dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),

      updateSettings: (patch) => set((state) => ({ settings: { ...state.settings, ...patch } })),
      setCommandOpen: (commandOpen) => set({ commandOpen }),
      setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
      setDevPanelOpen: (devPanelOpen) => set({ devPanelOpen }),
      setLastViewedFinding: (lastViewedFindingId) => set({ lastViewedFindingId }),
      setSeverityFilter: (severityFilter) => set({ severityFilter }),

      /* ── pull-request lifecycle ─────────────────────────────────── */
      fetchPrStatus: async (scanId) => {
        try {
          const status = await api.fetchPrStatus(scanId)
          set({ prStatus: status.error ? null : status })
        } catch {
          set({ prStatus: null })
        }
      },

      openPullRequest: async () => {
        const scanId = get().scanId
        if (!scanId || get().prLoading) return
        set({ prLoading: true })
        try {
          const result = await api.openPullRequest(scanId)
          if (result.error) {
            const leakNote = result.findings?.length
              ? ` ${result.findings.length} possible secret(s) in the changed files — nothing was pushed.`
              : ''
            get().pushToast({
              title: 'Could not open the pull request',
              body: `${result.error}${leakNote}`,
              tone: 'error',
            })
          } else if (result.pr_url) {
            set({ prStatus: { ...(get().prStatus ?? { branch: '', clone_available: true, commit_count: 0, commit_messages: [], token_configured: true }), pr_url: result.pr_url } })
            get().pushToast({
              title: result.already_open ? 'Pull request already open' : 'Pull request opened',
              body: result.pr_url,
              tone: 'success',
            })
          }
        } catch (err) {
          get().pushToast({
            title: 'Could not open the pull request',
            body: err instanceof Error ? err.message : 'Request failed',
            tone: 'error',
          })
        } finally {
          set({ prLoading: false })
        }
      },
      clearHistory: async () => {
        // Clearing history deletes the scans server-side too — findings,
        // rows and working copies — not just the local list.
        const { history } = get()
        await Promise.allSettled(
          history.map((entry) => api.deleteScan(entry.scanId).catch(() => null)),
        )
        set({
          history: [],
          results: null,
          scanId: '',
          lastViewedFindingId: null,
          severityFilter: 'all',
        })
        // Also delete the frozen legacy/anonymous blobs — before the fix
        // that seeded deleted history back out of them on every boot.
        purgeLegacyBuckets()
      },
      removeHistoryEntry: (scanId) => {
        // Same permanence per entry.
        void api.deleteScan(scanId).catch(() => null)
        set((state) => ({ history: state.history.filter((h) => h.scanId !== scanId) }))
      },
    }),
    {
      name: 'kovr-frontend',
      storage: perUserStorage(),
      version: 4,
      // v2 added settings.developerMode; v3 removed the never-wired
      // defaultSeverityFilter; v4 added settings.notifications. Migrations
      // backfill/remove so older saved states load cleanly.
      migrate: (persisted, _version) => {
        const state = persisted as Partial<ScanState> | undefined
        if (state?.settings) {
          const { defaultSeverityFilter: _removed, ...rest } = state.settings as Partial<UiSettings> & {
            defaultSeverityFilter?: unknown
          }
          state.settings = {
            density: 'comfortable',
            motion: 'on',
            notifications: true,
            developerMode: false,
            ...rest,
          } as UiSettings
        }
        // A corrupted or very old blob must never hand components an
        // undefined history — every list in the UI reads .length on it.
        if (state && !Array.isArray(state.history)) state.history = []
        if (state && !Array.isArray(state.selectedPillars)) {
          state.selectedPillars = [...PILLAR_KEYS]
        }
        return state as ScanState
      },
      // Only preferences, the session log, and which scan you were looking at
      // survive a reload. Findings and scores are always re-read from the
      // backend via GET /api/scan/{id}/results — never restored from storage.
      partialize: (state) => ({
        settings: state.settings,
        history: state.history,
        scanId: state.scanId,
        repoUrl: state.repoUrl,
        selectedPillars: state.selectedPillars,
      }),
    },
  ),
)

type SetState = (partial: Partial<ScanState> | ((state: ScanState) => Partial<ScanState>)) => void

/**
 * The bulk worker, ported unchanged from the supplied frontend: an
 * investigation with no usable patch is skipped, a fix that does not come back
 * as `fix_applied` fails, and only a `resolved` verification counts.
 */
async function processFinding(id: string, set: SetState) {
  const mark = (status: BulkStatus) =>
    set((state) => ({ bulkProgress: { ...state.bulkProgress, [id]: status } }))

  mark('investigating')
  set({ activeFindingId: id })

  try {
    // A malformed backend answer must never take the whole bulk run (or
    // the page) down — treat it like a skipped finding and move on.
    const invData = (await api.investigate(id)) as Record<string, unknown> | null

    if (!invData || typeof invData !== 'object') {
      mark('skipped')
      return
    }

    if (invData.scope === 'codebase_wide') {
      mark('codebase_wide')
      return
    }

    if (invData.error_type === 'quota_exceeded') {
      mark('ai_limit')
      // Keep the wording concrete: the user cannot run AI fixes right now
      // and can use them again once the limit clears.
      const rateLimit = api.parseRateLimitError((invData.error as string) ?? '')
      set({
        quotaNote: rateLimit?.retryIn
          ? `AI limit reached — you can use the AI again in ${rateLimit.retryIn}. Nothing is broken; retry these findings afterwards.`
          : 'AI limit reached — the daily AI quota is used up. You can use the AI again once the quota resets (within about 24 hours). Retry these findings afterwards.',
      })
      return
    }

    if (invData.error || (!(invData.before_code as string)?.trim() && !(invData.after_code as string)?.trim())) {
      mark('skipped')
      return
    }

    mark('fixing')
    const fixData = (await api.applyFix(id, 'approve')) as Record<string, unknown> | null

    if (!fixData || fixData.status !== 'fix_applied') {
      mark('failed')
      return
    }

    mark('verifying')
    const verifyData = (await api.verifyFix(id)) as Record<string, unknown> | null
    if (!verifyData) {
      mark('failed')
      return
    }
    if (verifyData.verified !== 'resolved' && verifyData.needs_manual_context) {
      mark('codebase_wide') // reuse the "needs broader review" bucket — same honest meaning
      return
    }
    mark(verifyData.verified === 'resolved' ? 'resolved' : 'failed')
  } catch {
    mark('failed')
  }
}
