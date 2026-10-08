import type { HTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

/* ── Card ────────────────────────────────────────────────────────────── */

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Cards separate with a 1px border, never a shadow (DESIGN.md). */
  interactive?: boolean
}

export function Card({ interactive, className, children, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-outline-variant bg-surface-container',
        interactive && 'transition-colors hover:bg-surface-container-high hover:border-outline',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  )
}

export function CardHeader({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-4 border-b border-outline-variant px-4 py-3',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  )
}

export function SectionLabel({ className, children, ...rest }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn('text-xs font-medium uppercase tracking-wider text-on-surface-variant', className)}
      {...rest}
    >
      {children}
    </h3>
  )
}

/* ── Input ───────────────────────────────────────────────────────────── */

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: ReactNode
  invalid?: boolean
}

export function Input({ icon, invalid, className, ...rest }: InputProps) {
  return (
    <div className="relative flex items-center">
      {icon && (
        <span className="pointer-events-none absolute left-3 text-on-surface-variant" aria-hidden>
          {icon}
        </span>
      )}
      <input
        aria-invalid={invalid || undefined}
        className={cn(
          'w-full rounded-lg border bg-surface-container-lowest py-2 text-sm text-on-surface',
          'placeholder:text-on-surface-variant/50 outline-none transition-colors',
          'focus:border-primary focus:ring-1 focus:ring-primary',
          invalid ? 'border-error' : 'border-outline-variant',
          icon ? 'pl-10 pr-3' : 'px-3',
          className,
        )}
        {...rest}
      />
    </div>
  )
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm',
        'text-on-surface outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary',
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  )
}

/* ── Switch ──────────────────────────────────────────────────────────── */

interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  description?: string
  disabled?: boolean
}

export function Switch({ checked, onChange, label, description, disabled }: SwitchProps) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start justify-between gap-6 py-3',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <span className="min-w-0">
        <span className="block text-sm text-on-surface">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-on-surface-variant">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition-colors duration-200',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
          checked
            ? 'border-primary bg-primary shadow-[0_0_12px_-2px_rgba(34,211,238,0.5)]'
            : 'border-outline bg-surface-container-highest',
        )}
      >
        {/* Explicit pixel offsets — fractional spacing utilities are not
            guaranteed to be generated, and a knob that never slides is
            what made this look like a dead dot. */}
        <span
          className={cn(
            'absolute top-[2px] left-[2px] h-[18px] w-[18px] rounded-full transition-all duration-200',
            'shadow-sm active:scale-90',
            checked ? 'translate-x-[20px] bg-on-primary' : 'translate-x-0 bg-outline',
          )}
        />
      </button>
    </label>
  )
}

/* ── Badge ───────────────────────────────────────────────────────────── */

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: 'neutral' | 'primary' | 'success' | 'warn' | 'error'
}

const BADGE_TONES = {
  neutral: 'border-outline-variant bg-surface-container-highest text-on-surface-variant',
  primary: 'border-primary/25 bg-primary/10 text-primary',
  success: 'border-tertiary/25 bg-tertiary/10 text-tertiary',
  warn: 'border-sev-medium/25 bg-sev-medium/10 text-sev-medium',
  error: 'border-error/25 bg-error/10 text-error',
} as const

export function Badge({ tone = 'neutral', className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium',
        BADGE_TONES[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  )
}

/* ── Progress ────────────────────────────────────────────────────────── */

export function ProgressBar({
  value,
  tone = 'primary',
  className,
  label,
}: {
  value: number
  tone?: 'primary' | 'success' | 'error'
  className?: string
  label?: string
}) {
  const colour =
    tone === 'success' ? 'bg-tertiary' : tone === 'error' ? 'bg-error' : 'bg-primary'
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-surface-container-highest', className)}
    >
      <div
        className={cn('h-full rounded-full transition-[width] duration-300 ease-out', colour)}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  )
}

/* ── Skeleton / empty ────────────────────────────────────────────────── */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-lg bg-surface-container-highest', className)} />
}

export function KeyCap({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-outline-variant bg-surface-container-lowest px-1.5 py-0.5 font-mono text-[10px] text-on-surface-variant">
      {children}
    </kbd>
  )
}
