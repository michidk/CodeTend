import { Badge } from '@/components/ui/badge'
import type { Confidence, FindingState, Severity } from '@/lib/findings'
import { cn } from '@/lib/utils'

const SEVERITY_CLASSES: Record<Severity, string> = {
  critical: 'bg-destructive text-white',
  high: 'bg-primary text-ink',
  medium: 'bg-candy-sun text-ink',
  low: 'bg-muted text-foreground',
}

export function SeverityBadge({ severity }: { readonly severity: Severity }) {
  return (
    <Badge className={cn('capitalize', SEVERITY_CLASSES[severity])}>
      {severity}
    </Badge>
  )
}

export function ConfidenceBadge({
  confidence,
}: {
  readonly confidence: Confidence
}) {
  return (
    <Badge variant="outline" className="capitalize">
      {confidence} confidence
    </Badge>
  )
}

const STATE_CLASSES: Record<FindingState, string> = {
  new: 'bg-candy-sky text-ink',
  active: 'bg-secondary text-secondary-foreground',
  improved: 'bg-candy-lime/50 text-ink',
  resolved: 'bg-candy-lime text-ink',
  regressed: 'bg-candy-pink text-ink',
}

export function FindingStateBadge({ state }: { readonly state: FindingState }) {
  return (
    <Badge className={cn('capitalize', STATE_CLASSES[state])}>{state}</Badge>
  )
}
