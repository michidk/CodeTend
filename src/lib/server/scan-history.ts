import { createServerFn } from '@tanstack/react-start'
import { desc, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { repositories, scans } from '@/db/schema'
import { ensureScheduler } from '@/lib/server/scheduler.server'

const HISTORY_LIMIT = 200

/**
 * Every scan across all repositories, newest first, plus lifetime token and
 * cost totals. The cost total only sums scans whose model had a known price;
 * `pricedScans` tells the UI how many scans that covered.
 */
export const getScanHistory = createServerFn({ method: 'GET' }).handler(
  async () => {
    ensureScheduler()
    const [rows, [totals]] = await Promise.all([
      db
        .select({
          id: scans.id,
          repositoryId: scans.repositoryId,
          repositoryName: repositories.name,
          status: scans.status,
          phase: scans.phase,
          trigger: scans.trigger,
          commitSha: scans.commitSha,
          overallScore: scans.overallScore,
          grade: scans.grade,
          counts: scans.counts,
          model: scans.model,
          inputTokens: scans.inputTokens,
          outputTokens: scans.outputTokens,
          cacheReadTokens: scans.cacheReadTokens,
          cacheWriteTokens: scans.cacheWriteTokens,
          estimatedCostUsd: scans.estimatedCostUsd,
          modelCalls: scans.modelCalls,
          startedAt: scans.startedAt,
          finishedAt: scans.finishedAt,
          createdAt: scans.createdAt,
        })
        .from(scans)
        .innerJoin(repositories, eq(scans.repositoryId, repositories.id))
        .orderBy(desc(scans.createdAt))
        .limit(HISTORY_LIMIT),
      db
        .select({
          scans: sql<number>`count(*)::int`,
          inputTokens: sql<number>`coalesce(sum(${scans.inputTokens}), 0)::bigint`,
          outputTokens: sql<number>`coalesce(sum(${scans.outputTokens}), 0)::bigint`,
          cacheReadTokens: sql<number>`coalesce(sum(${scans.cacheReadTokens}), 0)::bigint`,
          cacheWriteTokens: sql<number>`coalesce(sum(${scans.cacheWriteTokens}), 0)::bigint`,
          modelCalls: sql<number>`coalesce(sum(${scans.modelCalls}), 0)::bigint`,
          estimatedCostUsd: sql<number>`coalesce(sum(${scans.estimatedCostUsd}), 0)::float8`,
          pricedScans: sql<number>`count(${scans.estimatedCostUsd})::int`,
          trackedScans: sql<number>`count(${scans.modelCalls})::int`,
        })
        .from(scans),
    ])

    return {
      scans: rows,
      totals: {
        scans: totals?.scans ?? 0,
        inputTokens: Number(totals?.inputTokens ?? 0),
        outputTokens: Number(totals?.outputTokens ?? 0),
        cacheReadTokens: Number(totals?.cacheReadTokens ?? 0),
        cacheWriteTokens: Number(totals?.cacheWriteTokens ?? 0),
        modelCalls: Number(totals?.modelCalls ?? 0),
        estimatedCostUsd: totals?.estimatedCostUsd ?? 0,
        pricedScans: totals?.pricedScans ?? 0,
        trackedScans: totals?.trackedScans ?? 0,
      },
    }
  },
)

export type ScanHistoryRow = Awaited<
  ReturnType<typeof getScanHistory>
>['scans'][number]
