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
      <span
        className={cn(
          'inline-flex h-7 items-center rounded-full border-2 border-dashed border-ink/40 px-2.5 text-xs font-extrabold text-muted-foreground',
          className,
        )}
      >
        first scan
      </span>
    )
  }
  if (delta === 0) {
    return (
      <span
        className={cn(
          'inline-flex h-7 items-center gap-0.5 rounded-full border-2 border-ink bg-muted px-2.5 text-xs font-extrabold text-muted-foreground',
          className,
        )}
      >
        <Minus className="size-3.5" aria-hidden="true" strokeWidth={3} />
        no change
      </span>
    )
  }
  const positive = delta > 0
  return (
    <span
      className={cn(
        'inline-flex h-7 items-center gap-0.5 rounded-full border-2 border-ink px-2.5 text-xs font-extrabold tabular-nums text-ink',
        positive ? 'bg-candy-lime' : 'bg-candy-pink',
        className,
      )}
    >
      {positive ? (
        <ArrowUpRight className="size-3.5" aria-hidden="true" strokeWidth={3} />
      ) : (
        <ArrowDownRight
          className="size-3.5"
          aria-hidden="true"
          strokeWidth={3}
        />
      )}
      {positive ? '+' : ''}
      {delta.toFixed(1)}
      <span className="sr-only"> points since the previous scan</span>
    </span>
  )
}
