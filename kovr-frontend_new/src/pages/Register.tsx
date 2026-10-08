import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CheckCircle2, Eye, EyeOff, Lock, Mail, UserPlus, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/primitives'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { useAuthStore } from '@/store/useAuthStore'
import { cn } from '@/lib/cn'

const MIN_PASSWORD = 8

/** 0 = empty, 1 = weak, 2 = fair, 3 = strong. */
function passwordStrength(password: string): number {
  if (!password) return 0
  let score = 0
  if (password.length >= MIN_PASSWORD) score++
  if (password.length >= 12) score++
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++
  if (/\d/.test(password) || /[^A-Za-z0-9]/.test(password)) score++
  return Math.min(3, score)
}

const STRENGTH_META = [
  { label: '', bar: 'bg-transparent', text: 'text-on-surface-variant' },
  { label: 'Weak', bar: 'bg-error', text: 'text-error' },
  { label: 'Fair', bar: 'bg-sev-medium', text: 'text-sev-medium' },
  { label: 'Strong', bar: 'bg-tertiary', text: 'text-tertiary' },
]

export function Register() {
  const navigate = useNavigate()
  const register = useAuthStore((s) => s.register)
  const loading = useAuthStore((s) => s.loading)
  const error = useAuthStore((s) => s.error)
  const clearError = useAuthStore((s) => s.clearError)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [localError, setLocalError] = useState('')

  const strength = useMemo(() => passwordStrength(password), [password])
  const strengthMeta = STRENGTH_META[strength]
  const confirmState = confirm.length === 0 ? null : password === confirm

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (password.length < MIN_PASSWORD) {
      setLocalError(`Password must be at least ${MIN_PASSWORD} characters.`)
      return
    }
    if (password !== confirm) {
      setLocalError('Passwords do not match.')
      return
    }
    const ok = await register(email, password)
    if (ok) navigate('/connect', { replace: true })
  }

  const shown = localError || error

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Start scanning your repositories in minutes."
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {shown && (
          <p
            role="alert"
            className="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-sm text-on-error-container"
          >
            {shown}
          </p>
        )}

        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-on-surface-variant">Email</span>
          <Input
            type="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value)
              setLocalError('')
              clearError()
            }}
            autoComplete="email"
            required
            autoFocus
            placeholder="you@example.com"
            icon={<Mail size={15} />}
          />
        </label>

        <div className="space-y-1.5">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-on-surface-variant">Password</span>
            <span className="relative block">
              <Input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value)
                  setLocalError('')
                  clearError()
                }}
                autoComplete="new-password"
                required
                minLength={MIN_PASSWORD}
                placeholder={`At least ${MIN_PASSWORD} characters`}
                icon={<Lock size={15} />}
                className="pr-10"
              />
              <button
                type="button"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant transition-colors hover:text-on-surface"
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </span>
          </label>

          {password.length > 0 && (
            <div className="flex items-center gap-2">
              <div className="flex h-1 flex-1 gap-1 overflow-hidden rounded-full">
                {[1, 2, 3].map((level) => (
                  <span
                    key={level}
                    className={cn(
                      'h-full flex-1 rounded-full transition-colors',
                      level <= strength ? strengthMeta.bar : 'bg-surface-container-highest',
                    )}
                  />
                ))}
              </div>
              <span className={cn('w-12 text-right font-mono text-[10px]', strengthMeta.text)}>
                {strengthMeta.label}
              </span>
            </div>
          )}
        </div>

        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-on-surface-variant">Confirm password</span>
          <span className="relative block">
            <Input
              type={showPassword ? 'text' : 'password'}
              value={confirm}
              onChange={(event) => {
                setConfirm(event.target.value)
                setLocalError('')
                clearError()
              }}
              autoComplete="new-password"
              required
              placeholder="Repeat the password"
              className="pr-10"
              invalid={confirmState === false}
            />
            {confirmState !== null && (
              <span
                className="absolute right-2.5 top-1/2 -translate-y-1/2"
                aria-label={confirmState ? 'Passwords match' : 'Passwords do not match'}
              >
                {confirmState ? (
                  <CheckCircle2 size={15} className="text-tertiary" />
                ) : (
                  <X size={15} className="text-error" />
                )}
              </span>
            )}
          </span>
          {confirmState === false && (
            <span className="block text-[11px] text-error">Passwords do not match.</span>
          )}
        </label>

        <Button type="submit" variant="primary" size="lg" block disabled={loading} icon={<UserPlus size={16} />}>
          {loading ? 'Creating account…' : 'Create account'}
        </Button>
      </form>

      <p className="mt-5 text-center text-sm text-on-surface-variant">
        Already registered?{' '}
        <Link to="/login" className="font-medium text-primary transition-colors hover:underline">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  )
}
