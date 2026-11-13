import assert from 'node:assert/strict'
import { eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/db'
import { repositories, scans, schedulePositionOverrides } from '@/db/schema'
import { applySchedulePositions } from '@/lib/schedule-order'
import {
  loadScheduleCandidates,
  saveScheduleQueueImpl,
} from '@/lib/server/schedule-queue.server'
import { runSchedulerTick } from '@/lib/server/scheduler.server'

export async function verifyScheduleEditing() {
  const fixtures = await db
    .insert(repositories)
    .values(
      ['schedule-a', 'schedule-b', 'schedule-c'].map((name) => ({
        name,
        url: `https://github.com/test/${name}.git`,
        branch: 'main',
      })),
    )
    .returning()
  const [first, moved, untouched] = fixtures
  if (!first || !moved || !untouched)
    throw new Error('Schedule fixtures missing')
  const ids = fixtures.map((row) => row.id)
  try {
    const edit = {
      repositoryId: moved.id,
      position: -1023.5,
      expectedPosition: null,
      expectedUpdatedAt: null,
      lastScanAt: null,
    }
    await db.transaction(async (transaction) => {
      await transaction.execute(sql`select pg_advisory_xact_lock(47219302)`)
      await assert.rejects(
        () => saveScheduleQueueImpl({ changes: [edit] }),
        /scheduler is updating/i,
      )
      await runSchedulerTick()
    })
    await saveScheduleQueueImpl({ changes: [edit] })
    const stored = await db
      .select()
      .from(schedulePositionOverrides)
      .where(inArray(schedulePositionOverrides.repositoryId, ids))
    assert.equal(
      stored.length,
      1,
      'Only explicitly moved repositories are saved',
    )
    assert.equal(stored[0]?.repositoryId, moved.id)
    const { automatic } = await loadScheduleCandidates()
    assert.deepEqual(
      applySchedulePositions(
        automatic.filter((row) => ids.includes(row.id)),
      ).map((row) => row.id),
      [moved.id, first.id, untouched.id],
    )
    await assert.rejects(
      () => saveScheduleQueueImpl({ changes: [edit] }),
      /schedule changed/i,
    )
    const pinned = stored[0]
    if (!pinned) throw new Error('Pin missing')
    await saveScheduleQueueImpl({
      changes: [{ ...edit, repositoryId: untouched.id, position: 2048.5 }],
    })
    const beforeReset = await db
      .select()
      .from(schedulePositionOverrides)
      .where(eq(schedulePositionOverrides.repositoryId, untouched.id))
    await saveScheduleQueueImpl({
      changes: [
        {
          ...edit,
          position: null,
          expectedPosition: -1023.5,
          expectedUpdatedAt: pinned.updatedAt.toISOString(),
        },
      ],
    })
    assert.equal(
      await db.$count(
        schedulePositionOverrides,
        eq(schedulePositionOverrides.repositoryId, moved.id),
      ),
      0,
    )
    assert.deepEqual(
      await db
        .select()
        .from(schedulePositionOverrides)
        .where(eq(schedulePositionOverrides.repositoryId, untouched.id)),
      beforeReset,
      'Reset does not touch another override',
    )
    await db
      .update(repositories)
      .set({ scheduleEnabled: false })
      .where(eq(repositories.id, first.id))
    await assert.rejects(
      () =>
        saveScheduleQueueImpl({
          changes: [{ ...edit, repositoryId: first.id }],
        }),
      /schedule changed/i,
    )
    await db
      .insert(scans)
      .values({ repositoryId: moved.id, status: 'queued', trigger: 'manual' })
    await assert.rejects(
      () => saveScheduleQueueImpl({ changes: [edit] }),
      /started scanning/i,
    )
    const afterActive = await loadScheduleCandidates()
    assert.equal(
      afterActive.automatic.some((row) => row.id === moved.id),
      false,
    )
    assert.equal(
      afterActive.active.some((row) => row.id === moved.id),
      true,
    )
    await db
      .update(repositories)
      .set({ scheduleCronExpression: '0 3 * * *' })
      .where(eq(repositories.id, untouched.id))
    const afterCustom = await loadScheduleCandidates()
    assert.equal(
      afterCustom.automatic.some((row) => row.id === untouched.id),
      false,
    )
    assert.equal(
      afterCustom.custom.some((row) => row.id === untouched.id),
      true,
    )
    await assert.rejects(
      () =>
        saveScheduleQueueImpl({
          changes: [{ ...edit, repositoryId: untouched.id }],
        }),
      /schedule changed/i,
    )
  } finally {
    await db.delete(repositories).where(inArray(repositories.id, ids))
  }
}
