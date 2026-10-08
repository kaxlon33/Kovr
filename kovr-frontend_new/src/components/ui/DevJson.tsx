import { useState } from 'react'
import { Check, Copy, Terminal } from 'lucide-react'
import { Card } from '@/components/ui/primitives'

/**
 * Developer-mode raw payload viewer — terminal-styled, monospaced, with a
 * one-click copy so payloads can be pasted straight into an issue or curl.
 */
export function DevJson({ title, data }: { title: string; data: unknown }) {
  const [copied, setCopied] = useState(false)
  const json = JSON.stringify(data, null, 2)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable — the text is still selectable below */
    }
  }

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center justify-between gap-3 border-b border-outline-variant bg-surface-container-highest px-4 py-2.5">
        <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-on-surface">
          <Terminal size={14} className="shrink-0 text-primary" />
          <span className="truncate font-mono text-xs font-medium">{title}</span>
        </span>
        <button
          type="button"
          onClick={copy}
          className={
            copied
              ? 'flex shrink-0 items-center gap-1.5 rounded-md border border-tertiary/40 bg-tertiary/10 px-2 py-1 text-[11px] font-medium text-tertiary'
              : 'flex shrink-0 items-center gap-1.5 rounded-md border border-outline-variant px-2 py-1 text-[11px] font-medium text-on-surface-variant transition-colors hover:border-outline hover:text-on-surface'
          }
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="max-h-96 overflow-auto bg-[#07070a] p-4 font-mono text-[11px] leading-relaxed text-on-surface-variant">
        {json}
      </pre>
    </Card>
  )
}
