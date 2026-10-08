import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'
type Size = 'sm' | 'md' | 'lg'

const VARIANTS: Record<Variant, string> = {
  // Primary = solid cyan fill (DESIGN.md)
  primary: 'bg-primary text-on-primary hover:bg-primary-dim active:bg-primary shadow-sm shadow-primary/20',
  // Secondary = transparent + border, border lifts on hover
  secondary:
    'border border-outline-variant text-on-surface bg-transparent hover:bg-surface-container-high hover:border-outline',
  // Ghost = text only, visible on hover
  ghost: 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high',
  danger: 'border border-error/30 text-error bg-error/5 hover:bg-error/15 hover:border-error/50',
  success: 'border border-tertiary/30 text-tertiary bg-tertiary/5 hover:bg-tertiary/15 hover:border-tertiary/50',
}

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-base gap-2',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  icon?: ReactNode
  trailing?: ReactNode
  block?: boolean
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  trailing,
  block,
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center rounded-lg font-medium whitespace-nowrap',
        'transition-colors duration-150 active:scale-[0.98] transition-transform',
        'disabled:opacity-40 disabled:pointer-events-none',
        VARIANTS[variant],
        SIZES[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
      {trailing}
    </button>
  )
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  active?: boolean
}

/** Icon-only control — the accessible name is required, never optional. */
export function IconButton({ label, active, className, children, ...rest }: IconButtonProps) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors',
        active
          ? 'text-primary bg-secondary-container'
          : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}
