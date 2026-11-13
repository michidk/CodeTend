import '@tanstack/react-start/server-only'

import { and, eq, inArray, isNull, max, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  repositories,
  scans,
  scheduledRepositoryQueue,
  schedulePositionOverrides,
} from '@/db/schema'
import type { ScheduleEdits } from '@/lib/schedule-edits'
import { compareByLastScan } from '@/lib/scheduled-queue'

export async function loadScheduleCandidates() {
  const [eligible, priorities, overrides, queued, active] = await Promise.all([
    db
      .select()
      .from(repositories)
      .where(
        and(
          eq(repositories.scheduleEnabled, true),
          eq(repositories.archived, false),
        ),
      ),
    db
      .select({
        repositoryId: scans.repositoryId,
        lastAttemptAt: max(scans.createdAt),
        hasRating: sql<boolean>`bool_or(${scans.overallScore} is not null and ${scans.status} in ('completed', 'partial'))`,
      })
      .from(scans)
      .groupBy(scans.repositoryId),
    db.select().from(schedulePositionOverrides),
    db
      .select({ repositoryId: scheduledRepositoryQueue.repositoryId })
      .from(scheduledRepositoryQueue),
    db
      .select({ repositoryId: scans.repositoryId })
      .from(scans)
      .where(sql`${scans.status} in ('queued', 'running')`),
  ])
  const priorityById = new Map(priorities.map((row) => [row.repositoryId, row]))
  const overrideById = new Map(overrides.map((row) => [row.repositoryId, row]))
  const queuedIds = new Set(queued.map((row) => row.repositoryId))
  const activeIds = new Set(active.map((row) => row.repositoryId))
  const candidates = eligible
    .map((repository) => ({
      ...repository,
      lastScanAt: priorityById.get(repository.id)?.lastAttemptAt ?? null,
      hasRating: priorityById.get(repository.id)?.hasRating ?? false,
      position: overrideById.get(repository.id)?.position ?? null,
      positionUpdatedAt: overrideById.get(repository.id)?.updatedAt ?? null,
      queued: queuedIds.has(repository.id),
      active: activeIds.has(repository.id),
    }))
    .sort(compareByLastScan)
  return {
    automatic: candidates.filter(
      (row) => row.scheduleCronExpression === null && !row.active,
    ),
    custom: candidates.filter(
      (row) => row.scheduleCronExpression !== null && !row.active,
    ),
    active: candidates.filter((row) => row.active),
  }
}

export async function saveScheduleQueueImpl(data: ScheduleEdits) {
  const ids = data.changes.map((change) => change.repositoryId)
  await db.transaction(async (transaction) => {
    // Serialize editors without overwriting overrides from another open page.
    const result = await transaction.execute<{ locked: boolean }>(
      sql`select pg_try_advisory_xact_lock(47219302) as locked`,
    )
    if (!result[0]?.locked)
      throw new Error(
        'The scheduler is updating the schedule. Try saving again.',
      )
    const eligible = await transaction
      .select({ id: repositories.id })
      .from(repositories)
      .where(
        and(
          inArray(repositories.id, ids),
          eq(repositories.scheduleEnabled, true),
          eq(repositories.archived, false),
          isNull(repositories.scheduleCronExpression),
        ),
      )
    if (eligible.length !== ids.length)
      throw new Error('The schedule changed. Refresh before saving.')
    const active = await transaction
      .select({ id: scans.id })
      .from(scans)
      .where(
        and(
          inArray(scans.repositoryId, ids),
          inArray(scans.status, ['queued', 'running']),
        ),
      )
    if (active.length)
      throw new Error(
        'A repository has started scanning. Refresh before saving.',
      )
    const currentOverrides = await transaction
      .select()
      .from(schedulePositionOverrides)
    const nextRanks = [
      ...currentOverrides
        .filter((row) => !ids.includes(row.repositoryId))
        .map((row) => row.position),
      ...data.changes.flatMap((row) =>
        row.position === null ? [] : [row.position],
      ),
    ]
    if (new Set(nextRanks).size !== nextRanks.length)
      throw new Error('The schedule changed. Refresh before saving.')
    const positions = new Map(
      currentOverrides.map((row) => [row.repositoryId, row]),
    )
    const attempts = await transaction
      .select({
        repositoryId: scans.repositoryId,
        lastScanAt: sql<Date | null>`max(${scans.createdAt})`,
      })
      .from(scans)
      .where(inArray(scans.repositoryId, ids))
      .groupBy(scans.repositoryId)
    const lastAttempts = new Map(
      attempts.map((row) => [row.repositoryId, row.lastScanAt]),
    )
    const editTime = Date.now()
    for (const [index, change] of data.changes.entries()) {
      const updatedAt = new Date(editTime + index)
      const lastAttempt = lastAttempts.get(change.repositoryId)
      const lastAttemptIso = lastAttempt
        ? new Date(lastAttempt).toISOString()
        : null
      if (
        (positions.get(change.repositoryId)?.position ?? null) !==
          change.expectedPosition ||
        (positions.get(change.repositoryId)?.updatedAt.toISOString() ??
          null) !== change.expectedUpdatedAt ||
        lastAttemptIso !== change.lastScanAt
      ) {
        throw new Error('The schedule changed. Refresh before saving.')
      }
      if (change.position === null) {
        await transaction
          .delete(schedulePositionOverrides)
          .where(
            eq(schedulePositionOverrides.repositoryId, change.repositoryId),
          )
      } else {
        await transaction
          .insert(schedulePositionOverrides)
          .values({
            repositoryId: change.repositoryId,
            position: change.position,
            updatedAt,
          })
          .onConflictDoUpdate({
            target: schedulePositionOverrides.repositoryId,
            set: { position: change.position, updatedAt },
          })
      }
    }
  })
  return { saved: data.changes.length }
}
