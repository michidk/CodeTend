import { Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { ScanStatus } from '@/db/schema'
import { cn } from '@/lib/utils'

const STATUS_CLASSES: Record<ScanStatus, string> = {
  queued: 'bg-muted text-muted-foreground',
  running: 'bg-candy-sky text-ink',
  completed: 'bg-candy-lime text-ink',
  partial: 'bg-candy-sun text-ink',
  failed: 'bg-candy-pink text-ink',
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
