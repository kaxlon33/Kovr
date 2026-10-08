/**
 * Browser notification helper for scan completion — mirrors how
 * production apps (Claude, Slack, etc.) handle this: request permission
 * once at a natural moment, show a real OS-level notification when the
 * user isn't looking at the tab, and restore normal state when they
 * return.
 */

let originalTitle = document.title
let titleFlashInterval: ReturnType<typeof setInterval> | null = null

export function requestNotificationPermission(): void {
  if (!('Notification' in window)) return
  if (Notification.permission === 'default') {
    void Notification.requestPermission()
  }
}

export function notifyScanComplete(repoLabel: string, score: number, issueCount: number) {
  const title = 'Scan complete'
  const body = `${repoLabel} — ${issueCount} issue${issueCount === 1 ? '' : 's'} found, score ${score}`

  // Only show a real OS notification if the tab isn't focused — if the
  // user is already looking at the app, the in-app toast is enough and a
  // system notification on top would be redundant/annoying.
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    const notification = new Notification(title, {
      body,
      icon: '/favicon.svg',
      tag: 'kovr-scan-complete',
    })
    notification.onclick = () => {
      window.focus()
      notification.close()
    }
  }

  if (document.hidden) {
    startTitleFlash(`✓ ${title}`)
  }
}

function startTitleFlash(flashText: string) {
  if (titleFlashInterval) return
  originalTitle = document.title
  let showFlash = true
  titleFlashInterval = setInterval(() => {
    document.title = showFlash ? flashText : originalTitle
    showFlash = !showFlash
  }, 1500)

  const stop = () => {
    if (titleFlashInterval) {
      clearInterval(titleFlashInterval)
      titleFlashInterval = null
    }
    document.title = originalTitle
    document.removeEventListener('visibilitychange', onVisible)
  }
  const onVisible = () => {
    if (!document.hidden) stop()
  }
  document.addEventListener('visibilitychange', onVisible)
}