import type { Grade } from '@/lib/scoring'
import { cn } from '@/lib/utils'

const GRADE_CLASSES: Record<Grade, string> = {
  A: 'bg-grade-a text-ink',
  B: 'bg-grade-b text-ink',
  C: 'bg-grade-c text-ink',
  D: 'bg-grade-d text-ink',
  F: 'bg-grade-f text-ink',
}

const GRADE_TILT: Record<Grade, string> = {
  A: '-rotate-6',
  B: 'rotate-3',
  C: '-rotate-3',
  D: 'rotate-6',
  F: '-rotate-6',
}

/** A chunky letter block, like a wooden alphabet cube, tilted per grade. */
export function GradeBadge({
  grade,
  size = 'default',
  className,
}: {
  readonly grade: Grade | string | null | undefined
  readonly size?: 'sm' | 'default' | 'lg'
  readonly className?: string
}) {
  const known = grade && grade in GRADE_CLASSES ? (grade as Grade) : null
  return (
    <span
      role="img"
      aria-label={known ? `Grade ${known}` : 'Not graded yet'}
      className={cn(
        'inline-flex shrink-0 items-center justify-center border-ink font-display font-bold tabular-nums leading-none transition-transform duration-300 ease-spring hover:rotate-0 hover:scale-105 motion-reduce:transition-none',
        size === 'sm' && 'size-9 rounded-xl border-2 text-lg shadow-toy-sm',
        size === 'default' &&
          'size-12 rounded-2xl border-[3px] text-2xl shadow-toy-sm',
        size === 'lg' &&
          'size-24 rounded-[1.5rem] border-4 text-6xl shadow-toy-lg',
        known ? GRADE_TILT[known] : 'rotate-0',
        known ? GRADE_CLASSES[known] : 'bg-muted text-muted-foreground',
        className,
      )}
    >
      {known ?? '?'}
    </span>
  )
}

export function scoreTextClass(score: number | null | undefined): string {
  if (score == null) return 'text-muted-foreground'
  if (score >= 90) return 'text-grade-a-text'
  if (score >= 75) return 'text-grade-b-text'
  if (score >= 60) return 'text-grade-c-text'
  if (score >= 40) return 'text-grade-d-text'
  return 'text-grade-f-text'
}

export function formatScore(score: number | null | undefined): string {
  return score == null ? '?' : score.toFixed(score % 1 === 0 ? 0 : 1)
}
