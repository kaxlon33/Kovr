import { LoaderCircle } from 'lucide-react'

/** Shown while a reloaded page re-reads its scan from GET /api/scan/{id}/results. */
export function RestoringScan() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <LoaderCircle size={22} className="animate-spin text-primary" />
      <p className="text-sm text-on-surface-variant">Reading the scan back from the backend…</p>
    </div>
  )
}
