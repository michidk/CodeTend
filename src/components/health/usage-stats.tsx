import type { ReactNode } from 'react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { formatCostUsd, formatTokens } from '@/lib/format'
import { cn } from '@/lib/utils'

export interface UsageLike {
  readonly inputTokens: number | null
  readonly outputTokens: number | null
  readonly cacheReadTokens: number | null
  readonly cacheWriteTokens: number | null
  readonly estimatedCostUsd: number | null
  readonly modelCalls?: number | null
}

export function totalUsageTokens(usage: UsageLike): number | null {
  if (usage.inputTokens == null) return null
  return (
    usage.inputTokens +
    (usage.outputTokens ?? 0) +
    (usage.cacheReadTokens ?? 0) +
    (usage.cacheWriteTokens ?? 0)
  )
}

/** Token total with the input/output/cache split in a tooltip. */
export function TokensCell({ usage }: { readonly usage: UsageLike }) {
  const total = totalUsageTokens(usage)
  if (total == null) return <span className="text-muted-foreground">–</span>
  return (
    <Tooltip>
      <TooltipTrigger className="cursor-help tabular-nums underline decoration-dotted decoration-muted-foreground/60 underline-offset-4">
        {formatTokens(total)}
      </TooltipTrigger>
      <TooltipContent>
        <UsageBreakdown usage={usage} />
      </TooltipContent>
    </Tooltip>
  )
}

export function UsageBreakdown({ usage }: { readonly usage: UsageLike }) {
  const rows: [string, string][] = [
    ['Input', formatTokens(usage.inputTokens)],
    ['Cache read', formatTokens(usage.cacheReadTokens)],
    ['Cache write', formatTokens(usage.cacheWriteTokens)],
    ['Output', formatTokens(usage.outputTokens)],
  ]
  if (usage.modelCalls != null) {
    rows.push(['Model calls', String(usage.modelCalls)])
  }
  return (
    <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 text-xs">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="text-right tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function CostCell({
  value,
  tracked,
}: {
  readonly value: number | null
  /** Whether usage was recorded at all; distinguishes "unpriced" from "unknown". */
  readonly tracked: boolean
}) {
  if (value == null) {
    return (
      <span
        className="text-muted-foreground"
        title={
          tracked
            ? 'Tokens were recorded but the model has no known price.'
            : undefined
        }
      >
        {tracked ? 'n/a' : '–'}
      </span>
    )
  }
  return <span className="tabular-nums">{formatCostUsd(value)}</span>
}

/** A chunky stat tile matching the repository page counts grid. */
export function StatTile({
  label,
  value,
  hint,
  className,
}: {
  readonly label: string
  readonly value: ReactNode
  readonly hint?: ReactNode
  readonly className?: string
}) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-card px-4 py-4 shadow-deep',
        className,
      )}
    >
      <p className="font-display text-3xl font-bold tabular-nums">{value}</p>
      <p className="text-[11px] font-extrabold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      {hint ? (
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}
