import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db'
import { findings } from '@/db/schema'
import { DomainError, expectReturnedRow } from '@/lib/domain-errors'
import { FINDING_DISPOSITIONS, OPEN_FINDING_STATES } from '@/lib/findings'
import { recordFindingEvent } from '@/lib/server/finding-events.server'

const triageInputSchema = z
  .object({
    findingId: z.number().int().positive(),
    disposition: z.enum(FINDING_DISPOSITIONS).nullable(),
    note: z.string().trim().max(2_000).default(''),
  })
  .superRefine((value, context) => {
    if (value.disposition === 'accepted_risk' && value.note.length < 5) {
      context.addIssue({
        code: 'custom',
        path: ['note'],
        message: 'Explain the context in which this risk is acceptable.',
      })
    }
  })

export type FindingDispositionInput = z.infer<typeof triageInputSchema>

const markFixedInputSchema = z.object({
  findingId: z.number().int().positive(),
  note: z
    .string()
    .trim()
    .min(5, 'Describe what changed to fix this finding.')
    .max(2_000),
})

export type MarkFindingFixedInput = z.infer<typeof markFixedInputSchema>

/** Shared transaction used by both the owner UI and authenticated MCP tools. */
export const updateFindingDisposition = createServerOnlyFn(
  async (data: FindingDispositionInput) => {
    const parsed = triageInputSchema.parse(data)
    const current = await db.query.findings.findFirst({
      where: eq(findings.id, parsed.findingId),
      columns: { id: true, state: true, disposition: true },
    })
    if (!current) throw new DomainError('not_found', 'Finding not found')
    if (parsed.disposition === null && current.disposition === null) {
      throw new DomainError('conflict', 'This finding is not manually triaged.')
    }
    const editing =
      parsed.disposition !== null && current.disposition === parsed.disposition

    const [updated] = await db
      .update(findings)
      .set(
        parsed.disposition
          ? {
              state: 'resolved',
              disposition: parsed.disposition,
              dispositionNote: parsed.note || null,
              ...(editing ? {} : { triagedAt: new Date() }),
              resolvedScanId: null,
              updatedAt: new Date(),
            }
          : {
              state: 'active',
              disposition: null,
              dispositionNote: null,
              triagedAt: null,
              resolvedScanId: null,
              updatedAt: new Date(),
            },
      )
      .where(eq(findings.id, parsed.findingId))
      .returning({
        id: findings.id,
        state: findings.state,
        disposition: findings.disposition,
      })
    const row = expectReturnedRow(updated, 'Finding')

    await recordFindingEvent({
      findingId: row.id,
      actor: 'operator',
      kind: parsed.disposition
        ? editing
          ? 'disposition_updated'
          : 'disposition_set'
        : 'reopened',
      fromState: current.state,
      toState: row.state,
      disposition: parsed.disposition ?? current.disposition,
      note: parsed.disposition ? parsed.note || null : null,
    })

    return row
  },
)

/**
 * Records an explicit operator decision without conflating it with a code
 * fix. Calling it again with the same disposition only updates the context
 * note, so the original triage timestamp is kept.
 */
export const setFindingDisposition = createServerFn({ method: 'POST' })
  .validator(triageInputSchema)
  .handler(({ data }) => updateFindingDisposition(data))

/** Resolves a finding based on an operator-reported code fix. */
export const updateFindingAsFixed = createServerOnlyFn(
  async (data: MarkFindingFixedInput) => {
    const parsed = markFixedInputSchema.parse(data)
    const current = await db.query.findings.findFirst({
      where: eq(findings.id, parsed.findingId),
      columns: { id: true, state: true, disposition: true },
    })
    if (!current) throw new DomainError('not_found', 'Finding not found')
    if (
      current.disposition !== null ||
      !OPEN_FINDING_STATES.includes(current.state)
    ) {
      throw new DomainError(
        'conflict',
        'Only an active, non-triaged finding can be marked as fixed.',
      )
    }

    const [updated] = await db
      .update(findings)
      .set({
        state: 'resolved',
        disposition: null,
        dispositionNote: null,
        triagedAt: null,
        resolvedScanId: null,
        updatedAt: new Date(),
      })
      .where(eq(findings.id, parsed.findingId))
      .returning({
        id: findings.id,
        state: findings.state,
        disposition: findings.disposition,
      })
    const row = expectReturnedRow(updated, 'Finding')

    await recordFindingEvent({
      findingId: row.id,
      actor: 'operator',
      kind: 'resolved',
      fromState: current.state,
      toState: row.state,
      note: parsed.note,
    })

    return row
  },
)

export const markFindingFixed = createServerFn({ method: 'POST' })
  .validator(markFixedInputSchema)
  .handler(({ data }) => updateFindingAsFixed(data))
