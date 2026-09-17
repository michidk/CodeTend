import '@tanstack/react-start/server-only'

import { type DatabaseTransaction, db } from '@/db'
import { findingEvents } from '@/db/schema'
import type {
  FindingDisposition,
  FindingEventActor,
  FindingEventKind,
  FindingState,
} from '@/lib/findings'

export interface FindingEventInput {
  readonly findingId: number
  readonly scanId?: number | null
  readonly kind: FindingEventKind
  readonly actor: FindingEventActor
  readonly fromState: FindingState | null
  readonly toState: FindingState
  readonly disposition?: FindingDisposition | null
  readonly note?: string | null
}

/** Appends one entry to a finding's history log. */
export async function recordFindingEvent(
  event: FindingEventInput,
  database: Pick<DatabaseTransaction, 'insert'> = db,
) {
  await database
    .insert(findingEvents)
    .values({
      findingId: event.findingId,
      scanId: event.scanId ?? null,
      kind: event.kind,
      actor: event.actor,
      fromState: event.fromState,
      toState: event.toState,
      disposition: event.disposition ?? null,
      note: event.note ?? null,
    })
    .onConflictDoNothing()
}
