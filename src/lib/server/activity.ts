import { createServerFn } from '@tanstack/react-start'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db'
import { findingPatches, findings, scans } from '@/db/schema'

const positiveId = z.number().int().positive()

const activityScopeSchema = z.union([
  z.object({ kind: z.literal('all') }),
  z.object({ kind: z.literal('repository'), repositoryId: positiveId }),
  z.object({ kind: z.literal('scan'), scanId: positiveId }),
])

export type ActivityScope = z.infer<typeof activityScopeSchema>

/**
 * A cheap fingerprint of everything in flight for a page: running scans and
 * generating patches with their current phase. Pages poll this instead of
 * re-running their full loader, and only invalidate when it changes.
 */
export const getActivityStatus = createServerFn({ method: 'GET' })
  .validator(activityScopeSchema)
  .handler(async ({ data: scope }) => {
    const scanScope =
      scope.kind === 'repository'
        ? eq(scans.repositoryId, scope.repositoryId)
        : scope.kind === 'scan'
          ? eq(scans.id, scope.scanId)
          : undefined
    const patchScope =
      scope.kind === 'repository'
        ? eq(findings.repositoryId, scope.repositoryId)
        : scope.kind === 'scan'
          ? eq(findingPatches.sourceScanId, scope.scanId)
          : undefined

    const [activeScans, generatingPatches] = await Promise.all([
      db
        .select({
          id: scans.id,
          status: scans.status,
          phase: scans.phase,
          progress: scans.progress,
          cancelling: sql<boolean>`${scans.cancellationRequestedAt} is not null`,
        })
        .from(scans)
        .where(and(inArray(scans.status, ['queued', 'running']), scanScope)),
      db
        .select({ id: findingPatches.id })
        .from(findingPatches)
        .innerJoin(findings, eq(findingPatches.findingId, findings.id))
        .where(and(eq(findingPatches.status, 'generating'), patchScope)),
    ])

    const busy = activeScans.length > 0 || generatingPatches.length > 0
    const signature = [
      ...activeScans.map(
        (scan) =>
          `s${scan.id}:${scan.status}:${scan.phase ?? ''}:${JSON.stringify(scan.progress)}:${scan.cancelling ? 'c' : ''}`,
      ),
      ...generatingPatches.map((patch) => `p${patch.id}`),
    ].join('|')

    return { busy, signature }
  })
