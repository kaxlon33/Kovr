import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useScanStore } from '@/store/useScanStore'

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  )
}

/** App-wide keyboard shortcuts; every binding is listed in the shortcuts dialog. */
export function useGlobalHotkeys() {
  const navigate = useNavigate()
  const setCommandOpen = useScanStore((s) => s.setCommandOpen)
  const setShortcutsOpen = useScanStore((s) => s.setShortcutsOpen)

  useEffect(() => {
    let lastKey = ''
    let lastAt = 0

    const onKeyDown = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey

      if (meta && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandOpen(true)
        return
      }

      if (isTypingTarget(event.target)) return

      if (event.key === '?' || (event.shiftKey && event.key === '/')) {
        event.preventDefault()
        setShortcutsOpen(true)
        return
      }

      if (event.key === '/') {
        event.preventDefault()
        setCommandOpen(true)
        return
      }

      const now = Date.now()
      if (lastKey === 'g' && now - lastAt < 900) {
        const routes: Record<string, string> = {
          c: '/connect',
          s: '/scan',
          f: '/report',
          y: '/history',
          t: '/settings',
          h: '/docs',
        }
        const to = routes[event.key.toLowerCase()]
        if (to) {
          event.preventDefault()
          navigate(to)
        }
        lastKey = ''
        return
      }

      lastKey = event.key.toLowerCase()
      lastAt = now
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [navigate, setCommandOpen, setShortcutsOpen])
}
