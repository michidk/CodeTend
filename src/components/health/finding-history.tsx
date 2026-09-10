import { Link } from '@tanstack/react-router'
import type { FindingEvent } from '@/db/schema'
import type { FindingEventKind } from '@/lib/findings'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'

const EVENT_LABELS: Record<FindingEventKind, string> = {
  detected: 'Detected',
  confirmed: 'Confirmed still present',
  improved: 'Improved',
  regressed: 'Regressed',
  resolved: 'Resolved',
  carried_forward: 'Carried forward',
  disposition_set: 'Ignored',
  disposition_updated: 'Context updated',
  disposition_retained: 'Still ignored',
  disposition_invalidated: 'Reopened by scanner',
  reopened: 'Reopened',
}

const DISPOSITION_WORDS = {
  false_positive: 'false positive',
  accepted_risk: 'accepted risk',
} as const

/** Events that warrant a highlighted marker because someone should look. */
const ATTENTION_KINDS: ReadonlySet<FindingEventKind> = new Set([
  'disposition_invalidated',
  'regressed',
])

export function FindingHistory({
  events,
}: {
  readonly events: readonly FindingEvent[]
}) {
  if (events.length === 0) return null
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        History
      </p>
      <ol className="mt-2 space-y-2 border-l border-border pl-4">
        {events.map((event) => (
          <li key={event.id} className="relative">
            <span
              aria-hidden="true"
              className={cn(
                'absolute -left-[21px] top-1.5 size-2 rounded-full',
                ATTENTION_KINDS.has(event.kind)
                  ? 'bg-destructive'
                  : event.actor === 'operator'
                    ? 'bg-primary'
                    : 'bg-muted-foreground/50',
              )}
            />
            <p className="text-sm">
              <span className="font-semibold">{eventTitle(event)}</span>{' '}
              <span className="text-xs text-muted-foreground">
                · {event.actor === 'operator' ? 'operator' : 'scanner'}
                {event.scanId ? (
                  <>
                    {' · '}
                    <Link
                      to="/scans/$scanId"
                      params={{ scanId: String(event.scanId) }}
                      className="text-link hover:underline"
                    >
                      scan #{event.scanId}
                    </Link>
                  </>
                ) : null}
                {' · '}
                {formatDateTime(event.createdAt)}
              </span>
            </p>
            {event.note ? (
              <p className="mt-0.5 whitespace-pre-wrap text-xs text-muted-foreground">
                {event.note}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  )
}

function eventTitle(event: FindingEvent): string {
  const label = EVENT_LABELS[event.kind]
  if (!event.disposition) return label
  const word = DISPOSITION_WORDS[event.disposition]
  switch (event.kind) {
    case 'disposition_set':
      return `Ignored as ${word}`
    case 'disposition_retained':
      return `Still ignored (${word})`
    case 'disposition_invalidated':
      return `Reopened by scanner: ${word} no longer holds`
    case 'reopened':
      return `Reopened (was ${word})`
    default:
      return label
  }
}
