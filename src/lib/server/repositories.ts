import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db'
import { findings, repositories, scans } from '@/db/schema'
import { DomainError, expectReturnedRow } from '@/lib/domain-errors'
import { OPEN_FINDING_STATES } from '@/lib/findings'
import { computeNextScanAt, isValidCronExpression } from '@/lib/schedule'
import { startScan } from '@/lib/server/scan-pipeline.server'
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
    await db.delete(repositories).where(eq(repositories.id, id))
    return { id }
  })

export const triggerScan = createServerFn({ method: 'POST' })
  .validator(positiveId)
  .handler(async ({ data: repositoryId }) => {
    ensureScheduler()
    const scanId = await startScan(repositoryId, 'manual')
    if (scanId === null) {
      throw new DomainError(
        'conflict',
        'A scan is already running for this repository.',
      )
    }
    return { scanId }
  })
