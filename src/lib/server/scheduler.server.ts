import '@tanstack/react-start/server-only'

import { and, asc, eq, inArray, isNotNull, isNull, lte } from 'drizzle-orm'
import { db } from '@/db'
import {
  findingPatches,
  repositories,
  scanScheduleSettings,
  scans,
  scheduledRepositoryQueue,
} from '@/db/schema'
import { getServerEnv } from '@/lib/env.server'
import { computeNextScanAt } from '@/lib/schedule'
import { isScheduleDispatchReady } from '@/lib/scheduled-queue'
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

/**
 * Lightweight in-process scheduler. The global schedule durably enqueues
 * repositories that inherit it, while due repository overrides enqueue only
 * their repository. Each tick dispatches at most one queue entry, honoring the
 * configured cooldown and the normal scan-capacity limits.
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
        where: eq(findingPatches.status, 'generating'),
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
    })
    .catch((error) =>
      console.error('[CodeTend] scheduler initialization failed', error),
    )
}

async function tick(state: SchedulerState) {
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
      if (repositoryIds.length > 0) {
        await db
          .insert(scheduledRepositoryQueue)
          .values(repositoryIds)
          .onConflictDoNothing()
      }
      const [advanced] = await db
        .update(scanScheduleSettings)
        .set({
          nextRunAt: computeNextScanAt(settings.cronExpression, now),
          updatedAt: now,
        })
        .where(lte(scanScheduleSettings.nextRunAt, now))
        .returning()
      settings = advanced ?? settings
      console.info(
        `[CodeTend] queued ${repositoryIds.length} repositories for scheduled scanning`,
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
