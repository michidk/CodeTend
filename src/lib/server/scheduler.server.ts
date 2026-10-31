import '@tanstack/react-start/server-only'

import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  max,
  sql,
} from 'drizzle-orm'
import { db } from '@/db'
import {
  findingPatches,
  repositories,
  scanScheduleSettings,
  scans,
  scheduledRepositoryQueue,
} from '@/db/schema'
import { getServerEnv } from '@/lib/env.server'
import { computeNextDistributedScanAt, computeNextScanAt } from '@/lib/schedule'
import {
  compareByLastScan,
  isScheduleDispatchReady,
} from '@/lib/scheduled-queue'
import { dispatchExecutionQueues } from '@/lib/server/execution-queue.server'
import { recoverInterruptedPatches } from '@/lib/server/finding-patches.server'
import {
  pruneTransientPatchArtifacts,
  pruneTransientScanArtifacts,
} from '@/lib/server/scan-files.server'
import {
  recoverInterruptedScans,
  startScan,
} from '@/lib/server/scan-pipeline.server'
import { pruneTransientUsageFiles } from '@/lib/server/scan-usage.server'
import { ensureScheduleSettingsRow } from '@/lib/server/schedule-settings'

const SCHEDULER_KEY = Symbol.for('codetend.scheduler')

interface SchedulerState {
  timer: ReturnType<typeof setInterval>
  ticking: boolean
}

/** Runs one complete scheduler pass and resolves after its writes commit. */
export async function runSchedulerTick(): Promise<void> {
  await tick({ ticking: false })
}

/**
 * Lightweight in-process scheduler. Cron mode durably enqueues every
 * repository that inherits the global schedule; distributed mode rotates
 * through those repositories at evenly spaced scans-per-day slots. Due
 * repository overrides enqueue only their repository. Each tick dispatches at
 * most one queue entry, honoring the configured cooldown and normal capacity.
 */
export function ensureScheduler(): void {
  const globalState = globalThis as { [SCHEDULER_KEY]?: SchedulerState }
  if (globalState[SCHEDULER_KEY]) return

  const intervalMs = getServerEnv().SCHEDULER_INTERVAL_SECONDS * 1_000
  const state: SchedulerState = {
    ticking: false,
    timer: setInterval(() => void tick(state), intervalMs),
  }
  globalState[SCHEDULER_KEY] = state

  void Promise.all([recoverInterruptedScans(), recoverInterruptedPatches()])
    .catch((error) =>
      console.error('[CodeTend] failed to recover interrupted scans', error),
    )
    .then(async () => {
      const active = await db.query.scans.findMany({
        where: (table, { inArray }) =>
          inArray(table.status, ['queued', 'running']),
        columns: { id: true, eveSessionId: true },
      })
      const generatingPatches = await db.query.findingPatches.findMany({
        where: inArray(findingPatches.status, ['queued', 'generating']),
        columns: { id: true, eveSessionId: true },
      })
      const [scanFiles, patchFiles, usageFiles] = await Promise.all([
        pruneTransientScanArtifacts(new Set(active.map((scan) => scan.id))),
        pruneTransientPatchArtifacts(
          new Set(generatingPatches.map((patch) => patch.id)),
        ),
        pruneTransientUsageFiles(
          new Set(
            [...active, ...generatingPatches]
              .map((job) => job.eveSessionId)
              .filter((id): id is string => id !== null),
          ),
        ),
      ])
      if (scanFiles + patchFiles + usageFiles > 0) {
        console.info(
          `[CodeTend] removed ${scanFiles} stale scan files, ${patchFiles} stale patch files and ${usageFiles} usage files`,
        )
      }
      await tick(state)
      dispatchExecutionQueues()
    })
    .catch((error) =>
      console.error('[CodeTend] scheduler initialization failed', error),
    )
}

/** Rating availability and latest attempt time for scheduling priority. */
async function loadScanPriorities() {
  const rows = await db
    .select({
      repositoryId: scans.repositoryId,
      lastScanAt: max(scans.createdAt),
      hasRating: sql<boolean>`bool_or(${scans.overallScore} is not null and ${scans.status} in ('completed', 'partial'))`,
    })
    .from(scans)
    .groupBy(scans.repositoryId)
  return new Map(rows.map((row) => [row.repositoryId, row]))
}

async function tick(state: Pick<SchedulerState, 'ticking'>) {
  if (state.ticking) return
  state.ticking = true
  try {
    const now = new Date()
    let settings = await ensureScheduleSettingsRow()
    if (settings.enabled && settings.nextRunAt && settings.nextRunAt <= now) {
      const repositoryIds = await db
        .select({ repositoryId: repositories.id })
        .from(repositories)
        .where(
          and(
            eq(repositories.scheduleEnabled, true),
            isNull(repositories.scheduleCronExpression),
          ),
        )
        .orderBy(asc(repositories.createdAt), asc(repositories.id))
      let repositoryIdsToQueue = repositoryIds.map((row) => row.repositoryId)
      if (settings.mode === 'distributed') {
        const lastScans = await loadScanPriorities()
        const alreadyQueued = new Set(
          (
            await db
              .select({ id: scheduledRepositoryQueue.repositoryId })
              .from(scheduledRepositoryQueue)
          ).map((row) => row.id),
        )
        const stalest = repositoryIdsToQueue
          .filter((id) => !alreadyQueued.has(id))
          .map((id) => ({
            id,
            hasRating: lastScans.get(id)?.hasRating ?? false,
            lastScanAt: lastScans.get(id)?.lastScanAt ?? null,
          }))
          .sort(compareByLastScan)[0]
        repositoryIdsToQueue = stalest ? [stalest.id] : []
      }
      if (repositoryIdsToQueue.length > 0) {
        await db
          .insert(scheduledRepositoryQueue)
          .values(
            repositoryIdsToQueue.map((repositoryId) => ({ repositoryId })),
          )
          .onConflictDoNothing()
      }
      const [advanced] = await db
        .update(scanScheduleSettings)
        .set({
          nextRunAt:
            settings.mode === 'distributed'
              ? computeNextDistributedScanAt(settings.scansPerDay, now)
              : computeNextScanAt(settings.cronExpression, now),
          updatedAt: now,
        })
        .where(lte(scanScheduleSettings.nextRunAt, now))
        .returning()
      settings = advanced ?? settings
      console.info(
        `[CodeTend] queued ${repositoryIdsToQueue.length} repositories for ${settings.mode} scheduled scanning`,
      )
    }

    if (!settings.enabled) return

    const dueOverrides = await db.query.repositories.findMany({
      where: and(
        eq(repositories.scheduleEnabled, true),
        isNotNull(repositories.scheduleCronExpression),
        isNotNull(repositories.nextScheduledScanAt),
        lte(repositories.nextScheduledScanAt, now),
      ),
      columns: {
        id: true,
        scheduleCronExpression: true,
        nextScheduledScanAt: true,
      },
      orderBy: [asc(repositories.nextScheduledScanAt), asc(repositories.id)],
    })
    if (dueOverrides.length > 0) {
      await db.transaction(async (transaction) => {
        await transaction
          .insert(scheduledRepositoryQueue)
          .values(
            dueOverrides.map((repository) => ({
              repositoryId: repository.id,
            })),
          )
          .onConflictDoNothing()
        for (const repository of dueOverrides) {
          if (!repository.scheduleCronExpression) continue
          await transaction
            .update(repositories)
            .set({
              nextScheduledScanAt: computeNextScanAt(
                repository.scheduleCronExpression,
                now,
              ),
              updatedAt: now,
            })
            .where(
              and(
                eq(repositories.id, repository.id),
                lte(repositories.nextScheduledScanAt, now),
              ),
            )
        }
      })
      console.info(
        `[CodeTend] queued ${dueOverrides.length} repository schedule overrides`,
      )
    }

    if (
      !isScheduleDispatchReady(
        settings.lastDispatchedAt,
        settings.cooldownMinutes,
        now,
      )
    ) {
      return
    }

    const queue = await db
      .select({
        id: scheduledRepositoryQueue.id,
        repositoryId: scheduledRepositoryQueue.repositoryId,
        repositoryName: repositories.name,
      })
      .from(scheduledRepositoryQueue)
      .innerJoin(
        repositories,
        eq(scheduledRepositoryQueue.repositoryId, repositories.id),
      )
      .orderBy(
        asc(scheduledRepositoryQueue.enqueuedAt),
        asc(scheduledRepositoryQueue.id),
      )
    if (queue.length === 0) return
    const lastScans = await loadScanPriorities()
    queue.sort((left, right) =>
      compareByLastScan(
        {
          id: left.repositoryId,
          hasRating: lastScans.get(left.repositoryId)?.hasRating ?? false,
          lastScanAt: lastScans.get(left.repositoryId)?.lastScanAt ?? null,
        },
        {
          id: right.repositoryId,
          hasRating: lastScans.get(right.repositoryId)?.hasRating ?? false,
          lastScanAt: lastScans.get(right.repositoryId)?.lastScanAt ?? null,
        },
      ),
    )

    const activeScans = await db.query.scans.findMany({
      where: inArray(scans.status, ['queued', 'running']),
      columns: { repositoryId: true },
    })
    const activeRepositoryIds = new Set(
      activeScans.map((scan) => scan.repositoryId),
    )
    const next = queue.find(
      (entry) => !activeRepositoryIds.has(entry.repositoryId),
    )
    if (!next) return

    const scanId = await startScan(next.repositoryId, 'schedule', {
      maxInputTokens: settings.maxInputTokens,
    })
    if (!scanId) return
    await db.transaction(async (transaction) => {
      await transaction
        .delete(scheduledRepositoryQueue)
        .where(eq(scheduledRepositoryQueue.id, next.id))
      await transaction
        .update(scanScheduleSettings)
        .set({ lastDispatchedAt: now, updatedAt: now })
        .where(eq(scanScheduleSettings.id, settings.id))
    })
    console.info(
      `[CodeTend] scheduled scan ${scanId} for ${next.repositoryName}`,
    )
  } catch (error) {
    console.error('[CodeTend] scheduler tick failed', error)
  } finally {
    state.ticking = false
  }
}
