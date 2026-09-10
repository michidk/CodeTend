import { Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { ScanStatus } from '@/db/schema'
import { cn } from '@/lib/utils'

const STATUS_CLASSES: Record<ScanStatus, string> = {
  queued: 'border-transparent bg-muted text-muted-foreground',
  running: 'border-transparent bg-accent text-accent-foreground',
  completed: 'border-transparent bg-positive/15 text-positive-text',
  partial: 'border-transparent bg-warning/15 text-warning-text',
  failed: 'border-transparent bg-destructive/15 text-destructive-text',
  cancelled: 'border-transparent bg-muted text-muted-foreground',
}

export function ScanStatusBadge({
  status,
  phase,
}: {
  readonly status: ScanStatus
  readonly phase?: string | null
}) {
  const active = status === 'queued' || status === 'running'
  return (
    <Badge className={cn('gap-1 capitalize', STATUS_CLASSES[status])}>
      {active ? (
        <Loader2
          className="size-3 animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
      ) : null}
      {active && phase ? phase : status}
    </Badge>
  )
}
