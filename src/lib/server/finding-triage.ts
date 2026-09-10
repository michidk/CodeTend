import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db'
import { findings } from '@/db/schema'
import { DomainError, expectReturnedRow } from '@/lib/domain-errors'
import { FINDING_DISPOSITIONS } from '@/lib/findings'

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

/**
 * Records an explicit operator decision without conflating it with a code
 * fix. Calling it again with the same disposition only updates the context
 * note, so the original triage timestamp is kept.
 */
export const setFindingDisposition = createServerFn({ method: 'POST' })
  .validator(triageInputSchema)
  .handler(async ({ data }) => {
    const current = await db.query.findings.findFirst({
      where: eq(findings.id, data.findingId),
      columns: { id: true, disposition: true },
    })
    if (!current) throw new DomainError('not_found', 'Finding not found')
    if (data.disposition === null && current.disposition === null) {
      throw new DomainError('conflict', 'This finding is not manually triaged.')
    }

    const [updated] = await db
      .update(findings)
      .set(
        data.disposition
          ? {
              state: 'resolved',
              disposition: data.disposition,
              dispositionNote: data.note || null,
              ...(current.disposition === data.disposition
                ? {}
                : { triagedAt: new Date() }),
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
      .where(eq(findings.id, data.findingId))
      .returning({
        id: findings.id,
        state: findings.state,
        disposition: findings.disposition,
      })

    return expectReturnedRow(updated, 'Finding')
  })
