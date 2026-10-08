import { Modal } from '@/components/ui/Modal'
import { KeyCap } from '@/components/ui/primitives'
import { useScanStore } from '@/store/useScanStore'

const GROUPS: { title: string; items: { keys: string[]; label: string }[] }[] = [
  {
    title: 'General',
    items: [
      { keys: ['Ctrl', 'K'], label: 'Open the command palette' },
      { keys: ['/'], label: 'Search findings' },
      { keys: ['?'], label: 'Show this dialog' },
      { keys: ['Esc'], label: 'Close any overlay' },
    ],
  },
  {
    title: 'Navigate',
    items: [
      { keys: ['G', 'C'], label: 'Connect repository' },
      { keys: ['G', 'S'], label: 'Live scan' },
      { keys: ['G', 'F'], label: 'Findings' },
      { keys: ['G', 'Y'], label: 'Session history' },
      { keys: ['G', 'T'], label: 'Settings' },
      { keys: ['G', 'H'], label: 'Documentation' },
    ],
  },
  {
    title: 'Findings list',
    items: [
      { keys: ['J'], label: 'Next finding' },
      { keys: ['K'], label: 'Previous finding' },
      { keys: ['X'], label: 'Select or deselect the highlighted finding' },
      { keys: ['Enter'], label: 'Open the highlighted finding' },
    ],
  },
]

export function ShortcutsDialog() {
  const open = useScanStore((s) => s.shortcutsOpen)
  const setOpen = useScanStore((s) => s.setShortcutsOpen)

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title="Keyboard shortcuts"
      description="Everything here works without touching the mouse."
    >
      <div className="grid gap-6 p-5 sm:grid-cols-2">
        {GROUPS.map((group) => (
          <section key={group.title}>
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-on-surface-variant">
              {group.title}
            </h3>
            <ul className="space-y-2">
              {group.items.map((item) => (
                <li key={item.label} className="flex items-center justify-between gap-4 text-sm">
                  <span className="text-on-surface-variant">{item.label}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {item.keys.map((key) => (
                      <KeyCap key={key}>{key}</KeyCap>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  )
}
