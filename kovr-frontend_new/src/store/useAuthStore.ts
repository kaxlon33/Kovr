import { create } from 'zustand'
import type { User } from '@/api/types'
import * as api from '@/api/client'
import { useScanStore } from '@/store/useScanStore'
import { setStorageOwner } from '@/lib/perUserStorage'

/**
 * Switch the scan store's persistence bucket to the given account and
 * reload it. Volatile (non-persisted) state — the previous user's open
 * report, investigations, selections — is cleared so nothing leaks across
 * accounts. Called on every identity change: login, register, logout and
 * the session restore on load.
 */
async function adoptUser(user: User | null): Promise<void> {
  setStorageOwner(user?.id ?? null)
  // Rehydrate FIRST, write never: reading the new account's bucket before
  // any setState. Persist serializes state on every set, so clearing
  // volatile fields BEFORE rehydrating used to write the boot-time memory
  // (seeded from the legacy blob, full of deleted history) over the
  // account's real bucket — resurrecting scans the user had cleared.
  await useScanStore.persist.rehydrate()
  useScanStore.setState({
    results: null,
    investigations: {},
    investigating: null,
    fixing: false,
    verifying: false,
    activeFindingId: null,
    lastViewedFindingId: null,
    bulkProgress: {},
    bulkRunning: false,
    bulkPaused: false,
    selectedIds: [],
    quotaNote: '',
    severityFilter: 'all',
  })
}

/**
 * Developer Mode is admin-only. The toggle lives in localStorage, so a
 * non-admin who enabled it before auth existed (or on another backend)
 * would otherwise keep the dev chrome. Force it off for non-admins
 * whenever their identity (re)loads.
 */
function demoteDeveloperModeIfStale(user: User | null): void {
  if (user && user.role === 'admin') return
  const scan = useScanStore.getState()
  if (scan.settings.developerMode) scan.updateSettings({ developerMode: false })
}

/** Admins get Developer Mode turned on the moment they sign in. */
function enableDeveloperModeForAdmin(user: User): void {
  if (user.role !== 'admin') return
  const scan = useScanStore.getState()
  if (!scan.settings.developerMode) scan.updateSettings({ developerMode: true })
}

interface AuthState {
  /* ── server state ─────────────────────────────────────────────── */
  user: User | null
  /** True once checkAuth has run — gates the login redirect so a page
   * reload doesn't bounce a valid session to /login. */
  authChecked: boolean
  /** True when the backend could not be reached at all — the user is NOT
   * signed out; the UI shows a retry screen instead of redirecting. */
  authUnavailable: boolean
  loading: boolean
  error: string

  /* ── actions ──────────────────────────────────────────────────── */
  login: (email: string, password: string) => Promise<boolean>
  register: (email: string, password: string) => Promise<boolean>
  logout: () => Promise<void>
  checkAuth: () => Promise<void>
  clearError: () => void
}

export const useAuthStore = create<AuthState>()((set) => ({
  user: null,
  authChecked: false,
  authUnavailable: false,
  loading: false,
  error: '',
  /* POST /api/auth/login — the httpOnly cookie is set by the response;
   * the store only keeps the non-sensitive user object. */
  login: async (email, password) => {
    set({ loading: true, error: '' })
    try {
      const user = await api.login(email.trim(), password)
      demoteDeveloperModeIfStale(user)
      enableDeveloperModeForAdmin(user)
      await adoptUser(user)
      set({ user, authChecked: true, loading: false })
      return true
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Login failed', loading: false })
      return false
    }
  },

  register: async (email, password) => {
    set({ loading: true, error: '' })
    try {
      const user = await api.register(email.trim(), password)
      demoteDeveloperModeIfStale(user)
      await adoptUser(user)
      set({ user, authChecked: true, loading: false })
      return true
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Registration failed', loading: false })
      return false
    }
  },

  logout: async () => {
    try {
      await api.logout()
    } catch {
      /* the cookie is cleared server-side or already gone — either way
         the local session ends */
    }
    demoteDeveloperModeIfStale(null)
    set({ user: null, error: '' })
    await adoptUser(null)
  },

  /* GET /api/auth/me — restores the session from the cookie on load.
   * A slow or unreachable backend NEVER signs the user out: only an
   * explicit 401/403 does. Slow responses are retried; the UI keeps its
   * previous state while retrying (no flicker) and auto-recovers the
   * moment the backend answers. */
  checkAuth: async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 1500))
      try {
        const result = await Promise.race([
          api.getCurrentUser(),
          new Promise<'slow'>((resolve) => setTimeout(() => resolve('slow'), 8000)),
        ])
        if (result !== 'slow') {
          demoteDeveloperModeIfStale(result)
          await adoptUser(result)
          set({ user: result, authChecked: true, authUnavailable: false })
          return
        }
      } catch {
        /* network/server error — retry */
      }
    }
    set({ authChecked: true, authUnavailable: true })
  },

  clearError: () => set({ error: '' }),
}))

/** Reactive selectors for use in components. */
export const selectIsAuthenticated = (s: AuthState) => s.user !== null
export const selectIsAdmin = (s: AuthState) => s.user?.role === 'admin'
