import { createServerFn } from '@tanstack/react-start'
import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db'
import {
  findingEvents,
  findingPatches,
  findings,
  findingValidations,
} from '@/db/schema'

const positiveId = z.number().int().positive()

/**
 * Columns a finding list needs to render a collapsed card: title, badges and
 * triage state. Long-form text, evidence, history and patches load on expand
 * through `getFindingDetail`, which keeps list payloads and SSR output small.
 */
export const FINDING_SUMMARY_COLUMNS = {
  id: true,
  repositoryId: true,
  scannerId: true,
  state: true,
  title: true,
  severity: true,
  confidence: true,
  effort: true,
  priority: true,
  priorityScore: true,
  disposition: true,
  dispositionNote: true,
  updatedAt: true,
} as const

/** Just enough of the latest event to flag "reopened by scanner" in a list. */
export const FINDING_LATEST_EVENT_COLUMNS = {
  id: true,
  kind: true,
  actor: true,
  disposition: true,
  note: true,
  scanId: true,
  createdAt: true,
} as const

/** Patch columns lists need: the page polls `generating` patches. */
export const FINDING_PATCH_STATUS_COLUMNS = {
  id: true,
  status: true,
} as const

/** Relations every finding list attaches to the summary columns. */
export const FINDING_SUMMARY_RELATIONS = {
  events: {
    columns: FINDING_LATEST_EVENT_COLUMNS,
    orderBy: [desc(findingEvents.createdAt)],
    limit: 1 as const,
  },
  patches: {
    columns: FINDING_PATCH_STATUS_COLUMNS,
    orderBy: [desc(findingPatches.createdAt)],
    limit: 1 as const,
  },
}

/** Everything an expanded finding card shows, fetched for one finding. */
export const getFindingDetail = createServerFn({ method: 'GET' })
  .validator(positiveId)
  .handler(async ({ data: findingId }) => {
    const finding = await db.query.findings.findFirst({
      where: eq(findings.id, findingId),
      with: {
        validations: {
          orderBy: [desc(findingValidations.createdAt)],
          limit: 1,
        },
        patches: {
          orderBy: [desc(findingPatches.createdAt)],
          limit: 3,
        },
        events: {
          orderBy: [desc(findingEvents.createdAt)],
          limit: 20,
        },
      },
    })
    return finding ?? null
  })

export type FindingDetail = NonNullable<
  Awaited<ReturnType<typeof getFindingDetail>>
>
