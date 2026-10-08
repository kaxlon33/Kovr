import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { IconButton } from '@/components/ui/Button'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  description?: string
  children: ReactNode
  /** `plain` drops the header chrome — used by the command palette. */
  variant?: 'panel' | 'plain'
  className?: string
}

export function Modal({ open, onClose, title, description, children, variant = 'panel', className }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !panelRef.current) return

      // Keep focus inside the dialog while it is open.
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    const previouslyFocused = document.activeElement as HTMLElement | null
    document.addEventListener('keydown', onKeyDown)
    document.body.style.overflow = 'hidden'
    panelRef.current?.querySelector<HTMLElement>('input, button, a')?.focus()

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = ''
      previouslyFocused?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  // Portaled to <body>: the overlay must layer at the ROOT, above the
  // sidebar (z-50) and any sticky header (z-40). Rendering in place traps
  // z-100 inside the ancestor's stacking context — the header/sidebar then
  // float above the backdrop and swallow clicks meant for the dialog.
  return createPortal(
    <div
      className="fixed inset-0 z-100 flex items-start justify-center overflow-y-auto bg-background/40 p-4 pt-[10vh] backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'animate-fade-up relative w-full max-w-lg overflow-hidden rounded-xl border border-outline-variant bg-surface-container/95 shadow-2xl shadow-black/50 backdrop-blur',
          className,
        )}
      >
        {/* Signature glow line along the top edge */}
        <div
          className="absolute left-0 top-0 h-px w-full bg-gradient-to-r from-transparent via-primary/40 to-transparent"
          aria-hidden
        />
        {variant === 'panel' && (
          <div className="flex items-start justify-between gap-4 border-b border-outline-variant px-5 py-4">
            <div>
              {title && <h2 className="text-base font-semibold text-on-surface">{title}</h2>}
              {description && <p className="mt-1 text-sm text-on-surface-variant">{description}</p>}
            </div>
            <IconButton label="Close dialog" onClick={onClose}>
              <X size={18} />
            </IconButton>
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  )
}
