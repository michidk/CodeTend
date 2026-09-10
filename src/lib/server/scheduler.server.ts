import '@tanstack/react-start/server-only'

import { and, eq, isNotNull, lte } from 'drizzle-orm'
import { db } from '@/db'
import { findingPatches, repositories } from '@/db/schema'
import { getServerEnv } from '@/lib/env.server'
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

  void Promise.all([recoverInterruptedScans(), recoverInterruptedPatches()])
    .catch((error) =>
      console.error('[tecdebt] failed to recover interrupted scans', error),
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
          `[tecdebt] removed ${scanFiles} stale scan files, ${patchFiles} stale patch files and ${usageFiles} usage files`,
        )
      }
      await tick(state)
    })
    .catch((error) =>
      console.error('[tecdebt] scheduler initialization failed', error),
    )
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
