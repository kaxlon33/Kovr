import { useEffect, useState } from 'react'
import { cn } from '@/lib/cn'
import { grade, scoreHex } from '@/lib/format'

interface ScoreRingProps {
  score: number
  size?: number
  thickness?: number
  /** Show the letter grade under the number. */
  showGrade?: boolean
  label?: string
  className?: string
}

const RADIUS = 45
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export function ScoreRing({
  score,
  size = 160,
  thickness = 8,
  showGrade = false,
  label,
  className,
}: ScoreRingProps) {
  // Animate from empty on mount so the ring draws itself in.
  const [shown, setShown] = useState(0)
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(score))
    return () => cancelAnimationFrame(frame)
  }, [score])

  const clamped = Math.max(0, Math.min(100, shown))
  const offset = CIRCUMFERENCE - (clamped / 100) * CIRCUMFERENCE
  const colour = scoreHex(score)

  return (
    <div className={cn('relative shrink-0', className)} style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="50" cy="50" r={RADIUS} fill="none" stroke="#27272a" strokeWidth={thickness} />
        <circle
          cx="50"
          cy="50"
          r={RADIUS}
          fill="none"
          stroke={colour}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-1000 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="font-semibold tracking-tighter text-on-surface tabular-nums"
          style={{ fontSize: size * 0.26 }}
        >
          {Math.round(score)}
        </span>
        <span className="text-xs text-on-surface-variant">
          {showGrade ? grade(score) : label ?? '/ 100'}
        </span>
      </div>
    </div>
  )
}
