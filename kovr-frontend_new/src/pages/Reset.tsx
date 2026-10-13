import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, KeyRound, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/primitives'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { resetPassword } from '@/api/client'

/** Step 2 of recovery: the emailed temporary password acts as the current
 * password once, while choosing the new one. */
export function Reset() {
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState(
    (location.state as { email?: string } | null)?.email ?? '',
  )
  const [tempPassword, setTempPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy) return
    if (newPassword !== confirm) {
      setError('New password and confirmation do not match.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const data = await resetPassword(email.trim(), tempPassword, newPassword)
      if (data.error) {
        setError(data.error)
      } else {
        // Any remembered credentials hold the old password — clear them.
        try {
          localStorage.removeItem('kovr:remembered')
        } catch {
          /* ignore */
        }
        navigate('/login', { state: { email: email.trim() } })
      }
    } catch {
      setError('Could not reach the server — check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout
      title="Set a new password"
      subtitle="Paste the temporary password from the email, then choose your new one."
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && (
          <p
            role="alert"
            className="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-sm text-on-error-container"
          >
            {error}
          </p>
        )}

        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-on-surface-variant">Email</span>
          <Input
            type="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value)
              setError('')
            }}
            autoComplete="email"
            required
            autoFocus
            placeholder="you@example.com"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-on-surface-variant">
            Temporary password (from the email)
          </span>
          <Input
            type="password"
            value={tempPassword}
            onChange={(event) => {
              setTempPassword(event.target.value)
              setError('')
            }}
            autoComplete="one-time-code"
            required
            placeholder="Paste the temporary password"
            icon={<KeyRound size={15} />}
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-on-surface-variant">New password</span>
          <Input
            type="password"
            value={newPassword}
            onChange={(event) => {
              setNewPassword(event.target.value)
              setError('')
            }}
            autoComplete="new-password"
            required
            minLength={8}
            placeholder="At least 8 characters"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-on-surface-variant">
            Confirm new password
          </span>
          <Input
            type="password"
            value={confirm}
            onChange={(event) => {
              setConfirm(event.target.value)
              setError('')
            }}
            autoComplete="new-password"
            required
            minLength={8}
            placeholder="Repeat the new password"
          />
        </label>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          block
          disabled={busy || !email.trim() || !tempPassword || !newPassword || !confirm}
          icon={busy ? <LoaderCircle size={16} className="animate-spin" /> : <KeyRound size={16} />}
        >
          {busy ? 'Changing…' : 'Change password'}
        </Button>
      </form>

      <p className="mt-5 text-center text-sm text-on-surface-variant">
        <Link
          to="/forgot"
          className="inline-flex items-center gap-1.5 font-medium text-primary transition-colors hover:underline"
        >
          <ArrowLeft size={14} />
          Didn't get the email?
        </Link>
      </p>
    </AuthLayout>
  )
}
