import '@tanstack/react-start/server-only'

import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { type Repository, scannerRuns, scans } from '@/db/schema'
import { DomainError } from '@/lib/domain-errors'
import { cancelEveScanSession } from '@/lib/server/eve-client.server'
import { removeGitNexusIndex } from '@/lib/server/gitnexus.server'
import { waitForResultWithCheckpoints } from '@/lib/server/scan-execution.server'
import {
  readScanCheckpoint,
  readScanResult,
  removeScanArtifacts,
  removeScanWorkspace,
} from '@/lib/server/scan-files.server'
import {
  persistScanCheckpoint,
  persistScanResult,
} from '@/lib/server/scan-result-ingestion.server'
import {
  ACTIVE_SCAN_STATUSES,
  SCAN_TIMEOUT_MS,
  setScanProgress,
} from '@/lib/server/scan-runtime.server'
import {
  readScanUsage,
  removeScanUsage,
  type ScanUsage,
  usageColumns,
} from '@/lib/server/scan-usage.server'

const ORPHAN_GRACE_MS = 30 * 60_000

export async function recoverInterruptedScans(
  options: { readonly waitForCompletion?: boolean } = {},
): Promise<void> {
  const active = await db.query.scans.findMany({
    where: eq(scans.status, 'running'),
    with: { repository: true },
  })
  const recoveries = active.map((scan) =>
    adoptScan(scan.id, scan.repository, scan.createdAt).catch((error) =>
      console.error(`[CodeTend] failed to recover scan ${scan.id}`, error),
    ),
  )
  if (options.waitForCompletion) await Promise.all(recoveries)
}

async function adoptScan(
  scanId: number,
  repository: Repository,
  createdAt: Date,
) {
  const remaining = SCAN_TIMEOUT_MS - (Date.now() - createdAt.getTime())
  try {
    if (await cancellationRequested(scanId)) {
      await cancelScanRecord(scanId, repository.id)
      return
    }
    const checkpoint = await readScanCheckpoint(scanId)
    if (checkpoint) {
      await persistScanCheckpoint(scanId, repository, checkpoint)
    }
    if ((await readScanResult(scanId)) === null) {
      if (Date.now() - createdAt.getTime() > ORPHAN_GRACE_MS) {
        console.info(
          `[CodeTend] scan ${scanId} is older than the recovery grace period; preserving its checkpoint while waiting for Eve's durable workflow`,
        )
      }
      await waitForResultWithCheckpoints(
        scanId,
        Math.max(remaining, 60_000),
        async () => {
          const next = await readScanCheckpoint(scanId)
          if (next) await persistScanCheckpoint(scanId, repository, next)
        },
      )
    }
    const result = await readScanResult(scanId)
    if (!result) throw new Error('Scan result file disappeared.')
    await setScanProgress(scanId, {
      phase: 'reconciling',
      detail: 'Saving findings and scores',
      completed: 1,
      total: 1,
    })
    await persistScanResult(scanId, repository, result)
    await cleanupScanFiles(repository.id, scanId)
    console.info(`[CodeTend] recovered scan ${scanId} after restart`)
  } catch (error) {
    if (await cancellationRequested(scanId)) {
      await cancelScanRecord(scanId, repository.id)
    } else {
      await failScan(
        scanId,
        repository.id,
        error instanceof Error ? error.message : String(error),
      )
    }
  }
}

/**
 * Requests cooperative cancellation and keeps the scan active until Eve has
 * observed it. Queued scans without a session can be finalized immediately.
 */
export async function requestScanCancellation(scanId: number): Promise<void> {
  return requestScanCancellationWith(scanId, cancelEveScanSession)
}

/** Injectable cancellation boundary used by lifecycle integration tests. */
export async function requestScanCancellationWith(
  scanId: number,
  cancelSession: (sessionId: string) => Promise<unknown>,
): Promise<void> {
  const scan = await db.query.scans.findFirst({
    where: eq(scans.id, scanId),
    columns: {
      id: true,
      repositoryId: true,
      status: true,
      eveSessionId: true,
      cancellationRequestedAt: true,
    },
  })
  if (!scan) throw new DomainError('not_found', 'Scan not found')
  if (!ACTIVE_SCAN_STATUSES.includes(scan.status as 'queued' | 'running')) {
    throw new DomainError('conflict', 'Only an active scan can be cancelled.')
  }
  if (!scan.cancellationRequestedAt) {
    await db
      .update(scans)
      .set({ cancellationRequestedAt: new Date(), phase: 'cancelling' })
      .where(
        and(
          eq(scans.id, scanId),
          inArray(scans.status, [...ACTIVE_SCAN_STATUSES]),
        ),
      )
  }
  if (!scan.eveSessionId) {
    await cancelScanRecord(scanId, scan.repositoryId)
    return
  }
  try {
    await cancelSession(scan.eveSessionId)
  } catch (error) {
    console.warn(
      `[CodeTend] Eve cancellation request failed for scan ${scanId}; the pipeline will stop at its next checkpoint`,
      error,
    )
  }
}

export async function cancellationRequested(scanId: number): Promise<boolean> {
  const scan = await db.query.scans.findFirst({
    where: eq(scans.id, scanId),
    columns: { cancellationRequestedAt: true },
  })
  return Boolean(scan?.cancellationRequestedAt)
}

export async function cancelScanRecord(scanId: number, repositoryId: number) {
  const usage = await loadScanUsage(scanId)
  const finishedAt = new Date()
  const cancelled = await db
    .update(scans)
    .set({
      status: 'cancelled',
      phase: 'cancelled',
      progress: null,
      error: null,
      model: usage?.model ?? null,
      ...usageColumns(usage?.total),
      finishedAt,
    })
    .where(
      and(eq(scans.id, scanId), inArray(scans.status, ['queued', 'running'])),
    )
    .returning({ id: scans.id })
  if (cancelled.length === 0) return
  await db
    .update(scannerRuns)
    .set({
      status: 'cancelled',
      error: null,
      finishedAt,
    })
    .where(
      and(
        eq(scannerRuns.scanId, scanId),
        inArray(scannerRuns.status, ['pending', 'running']),
      ),
    )
  await cleanupScanFiles(repositoryId, scanId)
  await discardScanUsage(usage)
}

export async function failScan(
  scanId: number,
  repositoryId: number,
  message: string,
) {
  const current = await db.query.scans.findFirst({
    where: eq(scans.id, scanId),
    columns: { cancellationRequestedAt: true },
  })
  if (current?.cancellationRequestedAt) {
    await cancelScanRecord(scanId, repositoryId)
    return
  }
  const usage = await loadScanUsage(scanId)
  await db
    .update(scans)
    .set({
      status: 'failed',
      phase: 'failed',
      progress: null,
      error: message,
      model: usage?.model ?? null,
      ...usageColumns(usage?.total),
      finishedAt: new Date(),
    })
    .where(eq(scans.id, scanId))
  const unfinishedRuns = await db.query.scannerRuns.findMany({
    where: and(
      eq(scannerRuns.scanId, scanId),
      inArray(scannerRuns.status, ['pending', 'running']),
    ),
    columns: { id: true, scannerId: true },
  })
  for (const run of unfinishedRuns) {
    await db
      .update(scannerRuns)
      .set({
        status: 'failed',
        error: 'Scan failed before this scanner produced a result.',
        finishedAt: new Date(),
        ...usageColumns(usage?.perScanner.get(run.scannerId)),
      })
      .where(eq(scannerRuns.id, run.id))
  }
  await cleanupScanFiles(repositoryId, scanId)
  await discardScanUsage(usage)
}

export async function cleanupScanFiles(repositoryId: number, scanId: number) {
  try {
    await removeGitNexusIndex(`repo-${repositoryId}-scan-${scanId}`)
  } catch (error) {
    console.warn(
      `[CodeTend] failed to remove GitNexus index for scan ${scanId}`,
      error,
    )
  }
  try {
    await Promise.all([
      removeScanWorkspace(repositoryId, scanId),
      removeScanArtifacts(scanId),
    ])
  } catch (error) {
    console.warn(
      `[CodeTend] failed to clean up files for scan ${scanId}`,
      error,
    )
  }
}

/**
 * Token usage recorded by the Eve hooks for this scan's session tree. The
 * hooks key the file by root session id, which is the session the app
 * created for the scan.
 */
export async function loadScanUsage(scanId: number): Promise<ScanUsage | null> {
  const scan = await db.query.scans.findFirst({
    where: eq(scans.id, scanId),
    columns: { eveSessionId: true },
  })
  if (!scan?.eveSessionId) return null
  try {
    return await readScanUsage(scan.eveSessionId)
  } catch (error) {
    console.warn(`[CodeTend] failed to read usage for scan ${scanId}`, error)
    return null
  }
}

/** Accounting cleanup must never change the outcome of a completed scan. */
export async function discardScanUsage(usage: ScanUsage | null): Promise<void> {
  if (!usage) return
  try {
    await removeScanUsage(usage.rootSessionId)
  } catch (error) {
    console.warn(
      `[CodeTend] failed to remove usage file ${usage.rootSessionId}`,
      error,
    )
  }
}
