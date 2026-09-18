import { Badge } from '@/components/ui/badge'
import type {
  Confidence,
  FindingDisposition,
  FindingState,
} from '@/lib/findings'
import { cn } from '@/lib/utils'

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
  new: 'border-transparent bg-accent text-accent-foreground',
  active: 'border-transparent bg-secondary text-secondary-foreground',
  improved: 'border-transparent bg-positive/15 text-positive-text',
  resolved: 'border-transparent bg-positive text-positive-foreground',
  regressed: 'border-transparent bg-destructive/15 text-destructive-text',
}

const DISPOSITION_LABELS: Record<FindingDisposition, string> = {
  false_positive: 'false positive',
  accepted_risk: 'accepted risk',
}

export function FindingStateBadge({
  state,
  disposition = null,
}: {
  readonly state: FindingState
  readonly disposition?: FindingDisposition | null
}) {
  if (disposition) {
    return (
      <Badge className="border-transparent bg-muted text-muted-foreground capitalize">
        {DISPOSITION_LABELS[disposition]}
      </Badge>
    )
  }
  return (
    <Badge className={cn('capitalize', STATE_CLASSES[state])}>{state}</Badge>
  )
}
