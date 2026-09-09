import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'

export function ScoreDelta({
  delta,
  className,
}: {
  readonly delta: number | null | undefined
  readonly className?: string
}) {
  if (delta == null) {
    return (
      <span className={cn('text-xs text-muted-foreground', className)}>
        first scan
      </span>
    )
  }
  if (delta === 0) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-0.5 text-xs font-semibold text-muted-foreground',
          className,
        )}
      >
        <Minus className="size-3.5" aria-hidden="true" />
        no change
      </span>
    )
  }
  const positive = delta > 0
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums',
        positive ? 'text-positive-text' : 'text-destructive-text',
        className,
      )}
    >
      {positive ? (
        <ArrowUpRight className="size-3.5" aria-hidden="true" />
      ) : (
        <ArrowDownRight className="size-3.5" aria-hidden="true" />
      )}
      {positive ? '+' : ''}
      {delta.toFixed(1)}
      <span className="sr-only"> points since the previous scan</span>
    </span>
  )
}
