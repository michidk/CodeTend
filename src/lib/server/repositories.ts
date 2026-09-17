import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db'
import {
  findingPatches,
  findings,
  repositories,
  scans,
  scheduledRepositoryQueue,
} from '@/db/schema'
import { DomainError, expectReturnedRow } from '@/lib/domain-errors'
import { getServerEnv } from '@/lib/env.server'
import { OPEN_FINDING_STATES } from '@/lib/findings'
import { validateRepositoryLocation } from '@/lib/repository-access'
import { computeNextScanAt, isValidCronExpression } from '@/lib/schedule'
import {
  MAX_SCAN_INPUT_TOKEN_BUDGET,
  scanTargetSchema,
} from '@/lib/security-scans'
import { listAvailableGitHubRepositories } from '@/lib/server/github-repositories.server'
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
import { ensureScheduleSettingsRow } from '@/lib/server/schedule-settings'
import { ensureScheduler } from '@/lib/server/scheduler.server'

const positiveId = z.number().int().positive()

const repositoryInputSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
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
    scheduleEnabled: z.boolean(),
    scheduleCronExpression: z
      .string()
      .trim()
      .min(9)
      .max(100)
      .refine(isValidCronExpression, 'Enter a valid 5-field cron expression')
      .nullable(),
  })
  .refine(
    (input) => input.scheduleEnabled || input.scheduleCronExpression === null,
    {
      message: 'A disabled repository cannot have a schedule override',
      path: ['scheduleCronExpression'],
    },
  )

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
    const [rows, scheduleSettings] = await Promise.all([
      db.query.repositories.findMany({
        orderBy: [desc(repositories.createdAt)],
      }),
      ensureScheduleSettingsRow(),
    ])
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
        schedule: {
          enabled: scheduleSettings.enabled && repository.scheduleEnabled,
          mode:
            repository.scheduleCronExpression === null
              ? scheduleSettings.mode
              : ('cron' as const),
          scansPerDay: scheduleSettings.scansPerDay,
          cronExpression:
            repository.scheduleCronExpression ??
            scheduleSettings.cronExpression,
          nextRunAt: !repository.scheduleEnabled
            ? null
            : repository.scheduleCronExpression === null
              ? scheduleSettings.nextRunAt
              : repository.nextScheduledScanAt,
          overridden: repository.scheduleCronExpression !== null,
        },
      }
    })
  },
)

export type DashboardRow = Awaited<ReturnType<typeof getDashboard>>[number]

function githubRepositoryKey(url: string): string | null {
  const match = url
    .trim()
    .replace(/\.git$/, '')
    .match(/^(?:https?:\/\/github\.com\/|git@github\.com:)([^/]+\/[^/]+)$/i)
  return match?.[1]?.toLowerCase() ?? null
}

export const getAvailableRepositories = createServerFn({
  method: 'GET',
}).handler(async () => {
  try {
    const [available, registered] = await Promise.all([
      listAvailableGitHubRepositories(),
      db.query.repositories.findMany({ columns: { url: true } }),
    ])
    const registeredKeys = new Set(
      registered
        .map((repository) => githubRepositoryKey(repository.url))
        .filter((key): key is string => key !== null),
    )
    return {
      configured: available.configured,
      error: null,
      repositories: available.repositories.map((repository) => ({
        ...repository,
        registered: registeredKeys.has(repository.name.toLowerCase()),
      })),
    }
  } catch (error) {
    console.error('[CodeTend] could not list GitHub repositories', error)
    return {
      configured: true,
      error:
        'GitHub repositories could not be loaded. You can still add one by URL.',
      repositories: [],
    }
  }
})

export const createRepository = createServerFn({ method: 'POST' })
  .validator(repositoryInputSchema)
  .handler(async ({ data }) => {
    assertRepositoryAccess(data.url)
    const [row] = await db
      .insert(repositories)
      .values({
        ...data,
        nextScheduledScanAt:
          data.scheduleEnabled && data.scheduleCronExpression
            ? computeNextScanAt(data.scheduleCronExpression, new Date())
            : null,
      })
      .returning()
    return expectReturnedRow(row, 'Repository')
  })

export const updateRepository = createServerFn({ method: 'POST' })
  .validator(repositoryInputSchema.safeExtend({ id: positiveId }))
  .handler(async ({ data }) => {
    assertRepositoryAccess(data.url)
    const { id, ...values } = data
    const current = await db.query.repositories.findFirst({
      where: eq(repositories.id, id),
    })
    if (!current) throw new DomainError('not_found', 'Repository not found')
    const scheduleChanged =
      current.scheduleEnabled !== values.scheduleEnabled ||
      current.scheduleCronExpression !== values.scheduleCronExpression
    const [row] = await db.transaction(async (transaction) => {
      const updated = await transaction
        .update(repositories)
        .set({
          ...values,
          nextScheduledScanAt: scheduleChanged
            ? values.scheduleEnabled && values.scheduleCronExpression
              ? computeNextScanAt(values.scheduleCronExpression, new Date())
              : null
            : current.nextScheduledScanAt,
          updatedAt: new Date(),
        })
        .where(eq(repositories.id, id))
        .returning()
      if (scheduleChanged) {
        await transaction
          .delete(scheduledRepositoryQueue)
          .where(eq(scheduledRepositoryQueue.repositoryId, id))
      }
      return updated
    })
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
          inArray(findingPatches.status, ['queued', 'generating']),
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
    }),
  )
  .handler(async ({ data }) => {
    ensureScheduler()
    const scanId = await startScan(data.repositoryId, 'manual')
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
      target: scanTargetSchema,
      maxInputTokens: z
        .number()
        .int()
        .min(10_000)
        .max(MAX_SCAN_INPUT_TOKEN_BUDGET),
      maxCostUsd: z.number().positive().max(10_000).nullable(),
    }),
  )
  .handler(async ({ data }) => {
    ensureScheduler()
    const scanId = await startScan(data.repositoryId, 'manual', {
      target: data.target,
      maxInputTokens: data.maxInputTokens,
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
