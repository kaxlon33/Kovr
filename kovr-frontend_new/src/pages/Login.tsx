import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, LogIn, Mail } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/primitives'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { useAuthStore } from '@/store/useAuthStore'

// "Remember me" keeps both fields pre-filled for the next visit. Obfuscated,
// not encrypted — a convenience for personal devices; the browser's password
// manager remains the more secure alternative.
const LAST_EMAIL_KEY = 'kovr:lastEmail'
const REMEMBERED_KEY = 'kovr:remembered'

function loadRemembered(): { email: string; password: string } | null {
  try {
    const raw = localStorage.getItem(REMEMBERED_KEY)
    if (!raw) return null
    const json = new TextDecoder().decode(Uint8Array.from(atob(raw), (c) => c.charCodeAt(0)))
    const parsed = JSON.parse(json) as { email?: string; password?: string }
    if (parsed?.email && parsed?.password) return parsed as { email: string; password: string }
    return null
  } catch {
    return null
  }
}

function saveRemembered(email: string, password: string) {
  try {
    const json = JSON.stringify({ email, password })
    localStorage.setItem(REMEMBERED_KEY, btoa(String.fromCharCode(...new TextEncoder().encode(json))))
  } catch {
    /* storage unavailable — remembering is a nicety, not a requirement */
  }
}

function clearRemembered() {
  try {
    localStorage.removeItem(REMEMBERED_KEY)
  } catch {
    /* ignore */
  }
}

export function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const login = useAuthStore((s) => s.login)
  const loading = useAuthStore((s) => s.loading)
  const error = useAuthStore((s) => s.error)
  const clearError = useAuthStore((s) => s.clearError)
  const user = useAuthStore((s) => s.user)

  const remembered = loadRemembered()
  const [email, setEmail] = useState(remembered?.email ?? '')
  const [password, setPassword] = useState(remembered?.password ?? '')
  const [remember, setRemember] = useState(Boolean(remembered))
  const [showPassword, setShowPassword] = useState(false)

  // Already signed in — never show the login form again.
  if (user) return <Navigate to="/connect" replace />

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    const ok = await login(email, password)
    if (ok) {
      if (remember) {
        saveRemembered(email.trim(), password)
      } else {
        clearRemembered()
      }
      try {
        localStorage.setItem(LAST_EMAIL_KEY, email.trim())
      } catch {
        /* ignore */
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

        <div className="flex items-center justify-between">
          {!remembered ? (
            <label className="flex cursor-pointer items-center gap-2 text-sm text-on-surface-variant">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              Remember me
            </label>
          ) : (
            <span />
          )}
          <Link
            to="/forgot"
            className="text-sm font-medium text-primary transition-colors hover:underline"
          >
            Forgot password?
          </Link>
        </div>

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
