import { useNavigate } from 'react-router-dom'
import { FolderGit2, History as HistoryIcon } from 'lucide-react'
import { Button } from '@/components/ui/Button'

/**
 * Shown when the user opens the scan or findings pages with nothing
 * loaded — instead of silently bouncing them to Connect, tell them what
 * to do next and offer both paths.
 */
export function EmptyScanState({ title, message }: { title: string; message: string }) {
  const navigate = useNavigate()

  return (
    <div className="animate-fade-up flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10">
        <FolderGit2 size={26} className="text-primary" aria-hidden />
      </span>
      <div>
        <p className="text-lg font-semibold text-on-surface">{title}</p>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-on-surface-variant">
          {message}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button
          variant="primary"
          icon={<FolderGit2 size={15} />}
          onClick={() => navigate('/connect')}
        >
          Clone a repository
        </Button>
        <Button
          variant="secondary"
          icon={<HistoryIcon size={15} />}
          onClick={() => navigate('/history')}
        >
          Browse history
        </Button>
      </div>
    </div>
  )
}
