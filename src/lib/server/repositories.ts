import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db'
import { findingPatches, findings, repositories, scans } from '@/db/schema'
import { DomainError, expectReturnedRow } from '@/lib/domain-errors'
import { getServerEnv } from '@/lib/env.server'
import { OPEN_FINDING_STATES } from '@/lib/findings'
import { validateRepositoryLocation } from '@/lib/repository-access'
import { computeNextScanAt, isValidCronExpression } from '@/lib/schedule'
import { SCAN_MODES, scanTargetSchema } from '@/lib/security-scans'
import { removeGitNexusIndex } from '@/lib/server/gitnexus.server'
import {
  removeScanArtifacts,
  removeScanWorkspace,
} from '@/lib/server/scan-files.server'
import {
  requestScanCancellation,
  startScan,
} from '@/lib/server/scan-pipeline.server'
import { removeScanUsage } from '@/lib/server/scan-usage.server'
import { ensureScheduler } from '@/lib/server/scheduler.server'

const positiveId = z.number().int().positive()

const cronSchema = z
  .string()
  .trim()
  .min(9)
  .max(100)
  .refine(isValidCronExpression, 'Enter a valid 5-field cron expression')

const repositoryInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  url: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .refine(
      (value) => /^(https?:\/\/|git@|ssh:\/\/|file:\/\/|\/)/.test(value),
      'Enter a Git URL (https://, ssh://, git@ or an absolute local path)',
    ),
  branch: z.string().trim().min(1).max(200),
  cronExpression: cronSchema,
  enabled: z.boolean(),
})

export type RepositoryInput = z.infer<typeof repositoryInputSchema>

function assertRepositoryAccess(url: string): void {
  const env = getServerEnv()
  const error = validateRepositoryLocation(url, {
    allowedHosts: env.TECDEBT_ALLOWED_GIT_HOSTS.split(','),
    allowLocal: env.TECDEBT_ALLOW_LOCAL_REPOSITORIES,
    allowInsecureHttp: env.TECDEBT_ALLOW_INSECURE_GIT,
  })
  if (error) throw new DomainError('validation', error)
}

/**
 * Dashboard rows: every repository with its latest completed scan, the scan
 * before it (for the delta), the number of open findings and the running scan.
 */
export const getDashboard = createServerFn({ method: 'GET' }).handler(
  async () => {
    ensureScheduler()
    const rows = await db.query.repositories.findMany({
      orderBy: [desc(repositories.createdAt)],
    })
    if (rows.length === 0) return []

    const ids = rows.map((row) => row.id)
    const [scoredScans, activeCounts, activeScans] = await Promise.all([
      db.query.scans.findMany({
        where: and(
          inArray(scans.repositoryId, ids),
          inArray(scans.status, ['completed', 'partial']),
        ),
        orderBy: [desc(scans.createdAt)],
        columns: {
          id: true,
          repositoryId: true,
          overallScore: true,
          grade: true,
          finishedAt: true,
          counts: true,
          status: true,
        },
      }),
      db
        .select({
          repositoryId: findings.repositoryId,
          count: sql<number>`count(*)::int`,
        })
        .from(findings)
        .where(
          and(
            inArray(findings.repositoryId, ids),
            inArray(findings.state, [...OPEN_FINDING_STATES]),
          ),
        )
        .groupBy(findings.repositoryId),
      db.query.scans.findMany({
        where: and(
          inArray(scans.repositoryId, ids),
          inArray(scans.status, ['queued', 'running']),
        ),
        columns: {
          id: true,
          repositoryId: true,
          status: true,
          phase: true,
          startedAt: true,
        },
      }),
    ])

    const openByRepository = new Map(
      activeCounts.map((row) => [row.repositoryId, row.count]),
    )
    const runningByRepository = new Map(
      activeScans.map((scan) => [scan.repositoryId, scan]),
    )

    return rows.map((repository) => {
      const history = scoredScans.filter(
        (scan) => scan.repositoryId === repository.id,
      )
      const latest = history[0] ?? null
      const previous = history[1] ?? null
      const delta =
        latest?.overallScore != null && previous?.overallScore != null
          ? Math.round((latest.overallScore - previous.overallScore) * 10) / 10
          : null
      return {
        ...repository,
        latestScan: latest,
        scoreDelta: delta,
        activeFindings: openByRepository.get(repository.id) ?? 0,
        runningScan: runningByRepository.get(repository.id) ?? null,
      }
    })
  },
)

export type DashboardRow = Awaited<ReturnType<typeof getDashboard>>[number]

export const createRepository = createServerFn({ method: 'POST' })
  .validator(repositoryInputSchema)
  .handler(async ({ data }) => {
    assertRepositoryAccess(data.url)
    const [row] = await db
      .insert(repositories)
      .values({
        ...data,
        nextScanAt: data.enabled
          ? computeNextScanAt(data.cronExpression, new Date())
          : null,
      })
      .returning()
    return expectReturnedRow(row, 'Repository')
  })

export const updateRepository = createServerFn({ method: 'POST' })
  .validator(repositoryInputSchema.extend({ id: positiveId }))
  .handler(async ({ data }) => {
    assertRepositoryAccess(data.url)
    const { id, ...values } = data
    const current = await db.query.repositories.findFirst({
      where: eq(repositories.id, id),
    })
    if (!current) throw new DomainError('not_found', 'Repository not found')
    const scheduleChanged =
      current.cronExpression !== values.cronExpression ||
      current.enabled !== values.enabled
    const [row] = await db
      .update(repositories)
      .set({
        ...values,
        nextScanAt: values.enabled
          ? scheduleChanged || !current.nextScanAt
            ? computeNextScanAt(values.cronExpression, new Date())
            : current.nextScanAt
          : null,
        updatedAt: new Date(),
      })
      .where(eq(repositories.id, id))
      .returning()
    return expectReturnedRow(row, 'Repository')
  })

export const deleteRepository = createServerFn({ method: 'POST' })
  .validator(positiveId)
  .handler(async ({ data: id }) => {
    const running = await db.query.scans.findFirst({
      where: and(
        eq(scans.repositoryId, id),
        inArray(scans.status, ['queued', 'running']),
      ),
    })
    if (running) {
      throw new DomainError(
        'conflict',
        'Wait for the running scan to finish before deleting.',
      )
    }
    const [generatingPatch] = await db
      .select({ id: findingPatches.id })
      .from(findingPatches)
      .innerJoin(findings, eq(findingPatches.findingId, findings.id))
      .where(
        and(
          eq(findings.repositoryId, id),
          eq(findingPatches.status, 'generating'),
        ),
      )
      .limit(1)
    if (generatingPatch) {
      throw new DomainError(
        'conflict',
        'Wait for the running patch job to finish before deleting.',
      )
    }
    const repositoryScans = await db.query.scans.findMany({
      where: eq(scans.repositoryId, id),
      columns: { id: true, eveSessionId: true },
    })
    await db.delete(repositories).where(eq(repositories.id, id))
    const cleanup = await Promise.allSettled(
      repositoryScans.flatMap((scan) => [
        removeGitNexusIndex(`repo-${id}-scan-${scan.id}`),
        removeScanWorkspace(id, scan.id),
        removeScanArtifacts(scan.id),
        ...(scan.eveSessionId ? [removeScanUsage(scan.eveSessionId)] : []),
      ]),
    )
    const cleanupFailures = cleanup.filter(
      (result) => result.status === 'rejected',
    ).length
    if (cleanupFailures > 0) {
      console.warn(
        `[CodeTend] repository ${id} deleted with ${cleanupFailures} artifact cleanup failures`,
      )
    }
    return { id }
  })

export const triggerScan = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      repositoryId: positiveId,
      mode: z.enum(SCAN_MODES).default('standard'),
    }),
  )
  .handler(async ({ data }) => {
    ensureScheduler()
    const scanId = await startScan(data.repositoryId, 'manual', {
      mode: data.mode,
    })
    if (scanId === null) {
      throw new DomainError(
        'conflict',
        'A scan is already running for this repository.',
      )
    }
    return { scanId }
  })

export const cancelScan = createServerFn({ method: 'POST' })
  .validator(positiveId)
  .handler(async ({ data: scanId }) => {
    await requestScanCancellation(scanId)
    return { scanId }
  })

export const triggerConfiguredScan = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      repositoryId: positiveId,
      mode: z.enum(SCAN_MODES),
      target: scanTargetSchema,
      maxCostUsd: z.number().positive().max(10_000).nullable(),
    }),
  )
  .handler(async ({ data }) => {
    ensureScheduler()
    const scanId = await startScan(data.repositoryId, 'manual', {
      mode: data.mode,
      target: data.target,
      maxCostUsd: data.maxCostUsd,
    })
    if (scanId === null) {
      throw new DomainError(
        'conflict',
        'A scan is already running for this repository.',
      )
    }
    return { scanId }
  })
