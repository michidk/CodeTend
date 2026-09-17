import '@tanstack/react-start/server-only'

import { and, asc, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { findingPatches, findings, repositories, scans } from '@/db/schema'
import { availableQueueCapacity } from '@/lib/agent-execution'
import { ensureScheduleSettingsRow } from '@/lib/server/schedule-settings'

const DISPATCH_STATE = Symbol.for('codetend.execution-queue')

interface DispatchState {
  scan: boolean
  fix: boolean
}

function state(): DispatchState {
  const globalState = globalThis as { [DISPATCH_STATE]?: DispatchState }
  globalState[DISPATCH_STATE] ??= { scan: false, fix: false }
  return globalState[DISPATCH_STATE]
}

/** Request a non-blocking pass over both durable FIFO execution queues. */
export function dispatchExecutionQueues(): void {
  void dispatchScans().catch((error) =>
    console.error('[CodeTend] scan queue dispatch failed', error),
  )
  void dispatchFixes().catch((error) =>
    console.error('[CodeTend] fix queue dispatch failed', error),
  )
}

export async function dispatchScans(): Promise<void> {
  const dispatchState = state()
  if (dispatchState.scan) return
  dispatchState.scan = true
  try {
    const settings = await ensureScheduleSettingsRow()
    const [active] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(scans)
      .where(eq(scans.status, 'running'))
    let available = availableQueueCapacity(
      settings.scanConcurrency,
      active?.count ?? 0,
    )
    while (available > 0) {
      const [next] = await db
        .select({ scan: scans, repository: repositories })
        .from(scans)
        .innerJoin(repositories, eq(scans.repositoryId, repositories.id))
        .where(eq(scans.status, 'queued'))
        .orderBy(asc(scans.createdAt), asc(scans.id))
        .limit(1)
      if (!next) break
      const claimed = await db
        .update(scans)
        .set({
          status: 'running',
          phase: 'preparing',
          progress: { phase: 'preparing', completed: 0, total: 1 },
          startedAt: new Date(),
        })
        .where(and(eq(scans.id, next.scan.id), eq(scans.status, 'queued')))
        .returning({ id: scans.id })
      if (claimed.length === 0) continue
      available -= 1
      const { runScanPipeline } = await import(
        '@/lib/server/scan-execution.server'
      )
      void runScanPipeline(next.scan.id, next.repository)
        .catch((error) =>
          console.error(`[CodeTend] scan ${next.scan.id} crashed`, error),
        )
        .finally(() => setTimeout(dispatchExecutionQueues, 0))
    }
  } finally {
    dispatchState.scan = false
  }
}

export async function dispatchFixes(): Promise<void> {
  const dispatchState = state()
  if (dispatchState.fix) return
  dispatchState.fix = true
  try {
    const settings = await ensureScheduleSettingsRow()
    const [active] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(findingPatches)
      .where(eq(findingPatches.status, 'generating'))
    let available = availableQueueCapacity(
      settings.fixConcurrency,
      active?.count ?? 0,
    )
    while (available > 0) {
      const [next] = await db
        .select({
          patchId: findingPatches.id,
          repositoryId: findings.repositoryId,
        })
        .from(findingPatches)
        .innerJoin(findings, eq(findingPatches.findingId, findings.id))
        .where(eq(findingPatches.status, 'queued'))
        .orderBy(asc(findingPatches.createdAt), asc(findingPatches.id))
        .limit(1)
      if (!next) break
      const claimed = await db
        .update(findingPatches)
        .set({
          status: 'generating',
          startedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(findingPatches.id, next.patchId),
            eq(findingPatches.status, 'queued'),
          ),
        )
        .returning({ id: findingPatches.id })
      if (claimed.length === 0) continue
      available -= 1
      const { runPatchPipeline } = await import(
        '@/lib/server/finding-patches.server'
      )
      void runPatchPipeline(next.patchId, next.repositoryId)
        .catch((error) =>
          console.error(`[CodeTend] patch ${next.patchId} crashed`, error),
        )
        .finally(() => setTimeout(dispatchExecutionQueues, 0))
    }
  } finally {
    dispatchState.fix = false
  }
}
