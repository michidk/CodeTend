import '@tanstack/react-start/server-only'

import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/db'
import { scans } from '@/db/schema'
import { createKeyedLock } from '@/lib/keyed-lock'
import type { ScanProgress } from '@/lib/scan-progress'

export const ACTIVE_SCAN_STATUSES = ['queued', 'running'] as const
export const SCAN_TIMEOUT_MS = 3 * 60 * 60_000

// Live events, polling, and recovery can observe the same checkpoint at once.
// Serialize their reconciliation with the final result for each scan.
export const withScanPersistenceLock = createKeyedLock<number>()

export async function setScanProgress(
  scanId: number,
  progress: ScanProgress,
): Promise<void> {
  await db
    .update(scans)
    .set({ phase: progress.phase, progress })
    .where(and(eq(scans.id, scanId), isNull(scans.cancellationRequestedAt)))
}

export async function throwIfCancellationRequested(
  scanId: number,
): Promise<void> {
  const scan = await db.query.scans.findFirst({
    where: eq(scans.id, scanId),
    columns: { cancellationRequestedAt: true },
  })
  if (scan?.cancellationRequestedAt) throw new ScanCancelledError()
}

export class ScanCancelledError extends Error {
  constructor() {
    super('Scan cancellation was requested.')
    this.name = 'ScanCancelledError'
  }
}
