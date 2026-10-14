import { useState } from 'react'
import { KeyRound, LoaderCircle, Lock } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/primitives'
import { FormAlert } from '@/components/ui/FormAlert'
import { Modal } from '@/components/ui/Modal'
import { useScanStore } from '@/store/useScanStore'
import { changePassword } from '@/api/client'

/**
 * Change-password dialog shared by the top-bar account menu and the
 * Connect header. Clears remembered login credentials on success so the
 * next sign-in asks afresh.
 */
export function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pushToast = useScanStore((s) => s.pushToast)
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (busy) return
    if (newPw !== confirmPw) {
      setError('New password and confirmation do not match.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const data = await changePassword(currentPw, newPw)
      if (data.error) {
        setError(data.error)
      } else {
        onClose()
        setCurrentPw('')
        setNewPw('')
        setConfirmPw('')
        try {
          localStorage.removeItem('kovr:remembered')
        } catch {
          /* ignore */
        }
        pushToast({
          title: 'Password changed',
          body: 'Use your new password next time you sign in.',
          tone: 'success',
        })
      }
    } catch {
      setError('Could not reach the server — try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Change password"
      variant="panel"
      description="Choose a new password for your account."
    >
      <form
        className="space-y-4 p-5"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        {error && <FormAlert>{error}</FormAlert>}
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-on-surface-variant">Current password</span>
          <Input
            type="password"
            value={currentPw}
            onChange={(event) => {
              setCurrentPw(event.target.value)
              setError('')
            }}
            autoComplete="current-password"
            required
            autoFocus
            icon={<Lock size={15} />}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-on-surface-variant">New password</span>
          <Input
            type="password"
            value={newPw}
            onChange={(event) => {
              setNewPw(event.target.value)
              setError('')
            }}
            autoComplete="new-password"
            required
            minLength={8}
            placeholder="At least 8 characters"
            icon={<Lock size={15} />}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-on-surface-variant">Confirm new password</span>
          <Input
            type="password"
            value={confirmPw}
            onChange={(event) => {
              setConfirmPw(event.target.value)
              setError('')
            }}
            autoComplete="new-password"
            required
            minLength={8}
            icon={<Lock size={15} />}
          />
        </label>
        <div className="flex justify-end gap-3 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={busy || !currentPw || !newPw || !confirmPw}
            icon={busy ? <LoaderCircle size={15} className="animate-spin" /> : <KeyRound size={15} />}
          >
            {busy ? 'Changing…' : 'Change password'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
