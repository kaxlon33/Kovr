import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Copy, LoaderCircle, Mail } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/primitives'
import { FormAlert } from '@/components/ui/FormAlert'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { forgotPassword } from '@/api/client'

/** Step 1 of recovery: enter the account email. With email configured, the
 * temporary password is emailed; without it (demo/self-service mode), the
 * temporary password is shown right here. Either way, step 2 turns it into
 * a new password. */
export function Forgot() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [tempPassword, setTempPassword] = useState('')
  const [copied, setCopied] = useState(false)

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (sending) return
    setSending(true)
    setError('')
    try {
      const data = await forgotPassword(email.trim())
      if (data.error) {
        setError(data.error)
      } else {
        setTempPassword((data as { temp_password?: string }).temp_password ?? '')
        setSent(true)
      }
    } catch {
      setError('Could not reach the server — check your connection and try again.')
    } finally {
      setSending(false)
    }
  }

  const copyTemp = async () => {
    try {
      await navigator.clipboard.writeText(tempPassword)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard unavailable — user can select the text manually */
    }
  }

  return (
    <AuthLayout
      title={sent ? 'Temporary password ready' : 'Forgot password'}
      subtitle={
        sent
          ? tempPassword
            ? 'Copy the temporary password below, then use it as your current password to set a new one.'
            : 'If an account exists for that email, a temporary password is on its way.'
          : "Enter your account email — we'll send a temporary password to set a new one."
      }
    >
      {sent ? (
        <div className="space-y-4">
          {tempPassword ? (
            <div className="rounded-lg border border-primary/25 bg-surface-container-lowest p-4">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-outline">
                Temporary password for {email.trim()}
              </p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-md border border-outline-variant bg-surface-container px-3 py-2 font-mono text-sm text-primary">
                  {tempPassword}
                </code>
                <Button variant="secondary" size="sm" icon={<Copy size={13} />} onClick={() => void copyTemp()}>
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
            </div>
          ) : (
            <p className="flex items-center gap-2 rounded-lg border border-tertiary/30 bg-tertiary/10 px-3 py-2.5 text-sm text-tertiary">
              <CheckCircle2 size={15} />
              Email sent to <span className="font-medium">{email.trim()}</span>
            </p>
          )}
          <Button
            variant="primary"
            size="lg"
            block
            onClick={() =>
              navigate('/reset', {
                state: { email: email.trim(), tempPassword: tempPassword || undefined },
              })
            }
          >
            Continue to reset password
          </Button>
          <p className="text-center text-xs text-on-surface-variant">
            Nothing arrived? Check spam, or{' '}
            <button
              type="button"
              onClick={() => {
                setSent(false)
                setTempPassword('')
              }}
              className="font-medium text-primary hover:underline"
            >
              try again
            </button>
          </p>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {error && <FormAlert>{error}</FormAlert>}
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
              icon={<Mail size={15} />}
            />
          </label>
          <Button
            type="submit"
            variant="primary"
            size="lg"
            block
            disabled={sending || !email.trim()}
            icon={sending ? <LoaderCircle size={16} className="animate-spin" /> : <Mail size={16} />}
          >
            {sending ? 'Working…' : 'Get temporary password'}
          </Button>
        </form>
      )}

      <p className="mt-5 text-center text-sm text-on-surface-variant">
        <Link
          to="/login"
          className="inline-flex items-center gap-1.5 font-medium text-primary transition-colors hover:underline"
        >
          <ArrowLeft size={14} />
          Back to sign in
        </Link>
      </p>
    </AuthLayout>
  )
}
