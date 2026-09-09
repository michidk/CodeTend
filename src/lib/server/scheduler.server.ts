import '@tanstack/react-start/server-only'

import { and, eq, isNotNull, lte } from 'drizzle-orm'
import { db } from '@/db'
import { repositories } from '@/db/schema'
import { getServerEnv } from '@/lib/env.server'
import { failOrphanedScans, startScan } from '@/lib/server/scan-pipeline.server'

const SCHEDULER_KEY = Symbol.for('tecdebt.scheduler')

interface SchedulerState {
  timer: ReturnType<typeof setInterval>
  ticking: boolean
}

/**
 * Lightweight in-process scheduler. Every tick finds enabled repositories
 * whose `nextScanAt` is due and starts a scan for each. `startScan` advances
 * `nextScanAt` and refuses to run two scans of one repository concurrently,
 * so a slow scan never piles up.
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

  void failOrphanedScans()
    .then((count) => {
      if (count > 0)
        console.warn(`[tecdebt] marked ${count} orphaned scan(s) as failed`)
    })
    .catch((error) =>
      console.error('[tecdebt] failed to clean up orphaned scans', error),
    )
    .then(() => tick(state))
}

async function tick(state: SchedulerState) {
  if (state.ticking) return
  state.ticking = true
  try {
    const due = await db.query.repositories.findMany({
      where: and(
        eq(repositories.enabled, true),
        isNotNull(repositories.nextScanAt),
        lte(repositories.nextScanAt, new Date()),
      ),
    })
    for (const repository of due) {
      const scanId = await startScan(repository.id, 'schedule')
      if (scanId)
        console.info(
          `[tecdebt] scheduled scan ${scanId} for ${repository.name}`,
        )
    }
  } catch (error) {
    console.error('[tecdebt] scheduler tick failed', error)
  } finally {
    state.ticking = false
  }
}
