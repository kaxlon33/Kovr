import { createJSONStorage } from 'zustand/middleware'

/**
 * Per-account persistence for the scan store.
 *
 * The persisted blob (history, settings, last scan) belongs to the signed-in
 * account, not the browser: switching users must not show the previous
 * account's scans. The auth store sets the active owner via setStorageOwner
 * and rehydrates the scan store whenever identity changes.
 *
 * Legacy migration: data written before accounts existed lives under the
 * unsuffixed key. A real account's missing bucket is seeded from it exactly
 * once (tracked by a marker). The anonymous bucket is NEVER seeded: that
 * frozen copy is where deleted history kept leaking back into fresh
 * sessions from.
 */

const LEGACY_KEY = 'kovr-frontend'
const ANONYMOUS_OWNER = 'anonymous'
let currentOwner = ANONYMOUS_OWNER

export function setStorageOwner(userId: string | null | undefined): void {
  currentOwner = userId ?? ANONYMOUS_OWNER
}

function bucketKey(name: string): string {
  return `${name}:${currentOwner}`
}

/** The bucket key the ACTIVE account persists under — for cross-tab sync. */
export function activeBucketKey(name: string): string {
  return bucketKey(name)
}

export function perUserStorage() {
  return createJSONStorage(() => ({
    getItem: (name: string) => {
      const key = bucketKey(name)
      const existing = localStorage.getItem(key)
      if (existing !== null) return existing

      // One-time seeding from the pre-accounts blob, real accounts only.
      // Anonymous must return null: seeding it resurrects deleted history
      // into every boot before auth resolves.
      if (currentOwner === ANONYMOUS_OWNER) return null
      const marker = `kovr-seeded:${currentOwner}`
      if (localStorage.getItem(marker) !== null) return null
      const legacy = localStorage.getItem(LEGACY_KEY)
      if (legacy === null) return null
      localStorage.setItem(marker, '1')
      localStorage.setItem(key, legacy)
      return legacy
    },
    setItem: (name: string, value: string) => {
      localStorage.setItem(bucketKey(name), value)
    },
    removeItem: (name: string) => {
      localStorage.removeItem(bucketKey(name))
    },
  }))
}

/**
 * Delete the frozen pre-account blob and the anonymous bucket — the stale
 * copies a past session left behind, from which cleared history could be
 * re-seeded. Called when the user clears their history; per-account buckets
 * of other users on this browser are untouched.
 */
export function purgeLegacyBuckets(name = 'kovr-frontend'): void {
  localStorage.removeItem(LEGACY_KEY)
  localStorage.removeItem(`${name}:${ANONYMOUS_OWNER}`)
}
