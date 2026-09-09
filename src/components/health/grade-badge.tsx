import type { Grade } from '@/lib/scoring'
import { cn } from '@/lib/utils'

const GRADE_CLASSES: Record<Grade, string> = {
  A: 'bg-grade-a text-white',
  B: 'bg-grade-b text-white',
  C: 'bg-grade-c text-white',
  D: 'bg-grade-d text-white',
  F: 'bg-grade-f text-white',
}

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
        'inline-flex shrink-0 items-center justify-center rounded-xl font-display font-extrabold tabular-nums leading-none',
        size === 'sm' && 'size-8 text-base',
        size === 'default' && 'size-11 text-xl',
        size === 'lg' && 'size-20 text-5xl',
        known ? GRADE_CLASSES[known] : 'bg-muted text-muted-foreground',
        className,
      )}
    >
      {known ?? '–'}
    </span>
  )
}

export function scoreTextClass(score: number | null | undefined): string {
  if (score == null) return 'text-muted-foreground'
  if (score >= 90) return 'text-grade-a'
  if (score >= 75) return 'text-grade-b'
  if (score >= 60) return 'text-grade-c'
  if (score >= 40) return 'text-grade-d'
  return 'text-grade-f'
}

export function formatScore(score: number | null | undefined): string {
  return score == null ? '–' : score.toFixed(score % 1 === 0 ? 0 : 1)
}
