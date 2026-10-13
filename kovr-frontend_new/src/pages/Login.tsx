import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, LogIn, Mail } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/primitives'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { useAuthStore } from '@/store/useAuthStore'

// Remembered across visits (never the password — the browser's password
// manager handles that via the autocomplete hints below).
const LAST_EMAIL_KEY = 'kovr:lastEmail'

export function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const login = useAuthStore((s) => s.login)
  const loading = useAuthStore((s) => s.loading)
  const error = useAuthStore((s) => s.error)
  const clearError = useAuthStore((s) => s.clearError)
  const user = useAuthStore((s) => s.user)

  const [email, setEmail] = useState(() => {
    try {
      return localStorage.getItem(LAST_EMAIL_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  // Already signed in — never show the login form again.
  if (user) return <Navigate to="/connect" replace />

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    const ok = await login(email, password)
    if (ok) {
      try {
        localStorage.setItem(LAST_EMAIL_KEY, email.trim())
      } catch {
        /* storage unavailable — prefill is a nicety, not a requirement */
      }
      const from = (location.state as { from?: string } | null)?.from
      navigate(from && from !== '/login' ? from : '/connect', { replace: true })
    }
  }

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to run and review security scans.">
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
              clearError()
            }}
            autoComplete="email"
            required
            autoFocus
            placeholder="you@example.com"
            icon={<Mail size={15} />}
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-on-surface-variant">Password</span>
          <span className="relative block">
            <Input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value)
                clearError()
              }}
              autoComplete="current-password"
              required
              placeholder="Your password"
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

        <Button type="submit" variant="primary" size="lg" block disabled={loading} icon={<LogIn size={16} />}>
          {loading ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      <p className="mt-5 text-center text-sm text-on-surface-variant">
        No account yet?{' '}
        <Link to="/register" className="font-medium text-primary transition-colors hover:underline">
          Create one
        </Link>
      </p>
    </AuthLayout>
  )
}
