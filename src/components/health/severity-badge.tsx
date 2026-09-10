import { Badge } from '@/components/ui/badge'
import type {
  Confidence,
  FindingDisposition,
  FindingPriority,
  FindingState,
  Severity,
} from '@/lib/findings'
import { cn } from '@/lib/utils'

const SEVERITY_CLASSES: Record<Severity, string> = {
  critical: 'border-transparent bg-grade-f text-white',
  high: 'border-transparent bg-grade-d text-white',
  medium: 'border-transparent bg-grade-c text-white',
  low: 'border-transparent bg-muted text-foreground',
}

export function SeverityBadge({ severity }: { readonly severity: Severity }) {
  return (
    <Badge className={cn('capitalize', SEVERITY_CLASSES[severity])}>
      {severity}
    </Badge>
  )
}

const PRIORITY_CLASSES: Record<FindingPriority, string> = {
  critical: 'border-transparent bg-grade-f text-white ring-2 ring-grade-f/25',
  high: 'border-transparent bg-grade-d text-white ring-2 ring-grade-d/20',
  medium: 'border-transparent bg-grade-c text-white',
  low: 'border-transparent bg-muted text-foreground',
}

export function PriorityBadge({
  priority,
  score,
}: {
  readonly priority: FindingPriority
  readonly score?: number | null
}) {
  return (
    <Badge className={cn('capitalize', PRIORITY_CLASSES[priority])}>
      {priority} priority{score == null ? '' : ` · ${Math.round(score)}`}
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
