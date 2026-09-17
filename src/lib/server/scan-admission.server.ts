import '@tanstack/react-start/server-only'

import { and, eq, gte, inArray, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  repositories,
  type ScanTrigger,
  scanScheduleSettings,
  scans,
  scheduledRepositoryQueue,
} from '@/db/schema'
import { DomainError } from '@/lib/domain-errors'
import { getServerEnv } from '@/lib/env.server'
import {
  DEFAULT_SCAN_INPUT_TOKEN_BUDGET,
  DEFAULT_SCAN_TARGET,
  type ScanTarget,
} from '@/lib/security-scans'
import { isDailyAiCostBudgetReached } from '@/lib/server/ai-cost-budget.server'
import { runScanPipeline } from '@/lib/server/scan-execution.server'
import { ACTIVE_SCAN_STATUSES } from '@/lib/server/scan-runtime.server'
import { listGlobalScanners } from '@/lib/server/scanner-settings'

/**
 * Creates a scan row for a repository and starts the pipeline in the
 * background. Returns null when a scan is already active for the repository,
 * which is how concurrent scans of the same repository are prevented.
 */
export async function startScan(
  repositoryId: number,
  trigger: ScanTrigger,
  options: {
    readonly target?: ScanTarget
    readonly maxInputTokens?: number
    readonly maxCostUsd?: number | null
  } = {},
): Promise<number | null> {
  const repository = await db.query.repositories.findFirst({
    where: eq(repositories.id, repositoryId),
  })
  if (!repository) throw new Error('Repository not found')

  const hasEnabledScanner = (await listGlobalScanners()).some(
    (scanner) => scanner.enabled,
  )
  if (!hasEnabledScanner) {
    if (trigger === 'manual') {
      throw new DomainError(
        'conflict',
        'No scanners are enabled. Enable a scanner and try again.',
      )
    }
    return null
  }

  const active = await db.query.scans.findFirst({
    where: and(
      eq(scans.repositoryId, repositoryId),
      inArray(scans.status, [...ACTIVE_SCAN_STATUSES]),
    ),
  })
  if (active) return null

  const env = getServerEnv()
  if (trigger === 'manual' && env.TECDEBT_MANUAL_SCAN_COOLDOWN_SECONDS > 0) {
    const cooldownStart = new Date(
      Date.now() - env.TECDEBT_MANUAL_SCAN_COOLDOWN_SECONDS * 1_000,
    )
    const recent = await db.query.scans.findFirst({
      where: and(
        eq(scans.repositoryId, repositoryId),
        eq(scans.trigger, 'manual'),
        gte(scans.createdAt, cooldownStart),
      ),
      columns: { id: true },
    })
    if (recent) {
      throw new DomainError(
        'conflict',
        `Wait ${env.TECDEBT_MANUAL_SCAN_COOLDOWN_SECONDS} seconds between manual scans.`,
      )
    }
  }

  const [capacity] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(scans)
    .where(inArray(scans.status, [...ACTIVE_SCAN_STATUSES]))
  if ((capacity?.count ?? 0) >= env.TECDEBT_MAX_ACTIVE_SCANS) {
    if (trigger === 'manual') {
      throw new DomainError(
        'conflict',
        'Scan capacity is full. Try again after a running scan finishes.',
      )
    }
    return null
  }

  if (await isDailyAiCostBudgetReached()) {
    if (trigger === 'manual') {
      throw new DomainError(
        'conflict',
        'The daily AI-cost budget has been reached.',
      )
    }
    return null
  }

  const globalSettings = await db.query.scanScheduleSettings.findFirst({
    where: eq(scanScheduleSettings.id, 1),
    columns: { maxInputTokens: true, defaultScanCostUsd: true },
  })
  let scan: { id: number } | undefined
  try {
    const inserted = await db
      .insert(scans)
      .values({
        repositoryId,
        trigger,
        mode: 'standard',
        target: options.target ?? DEFAULT_SCAN_TARGET,
        maxInputTokens:
          options.maxInputTokens ??
          globalSettings?.maxInputTokens ??
          DEFAULT_SCAN_INPUT_TOKEN_BUDGET,
        maxCostUsd:
          options.maxCostUsd ?? globalSettings?.defaultScanCostUsd ?? null,
        status: 'queued',
        phase: 'queued',
        progress: { phase: 'queued', completed: 0, total: 1 },
        branch: repository.branch,
      })
      .returning({ id: scans.id })
    scan = inserted[0]
  } catch (error) {
    if (postgresErrorCode(error) === '23505') return null
    throw error
  }
  if (!scan) throw new Error('Failed to create scan')

  // A manual scan satisfies any pending scheduled work for this repository,
  // preventing the global queue from scanning it again immediately afterward.
  if (trigger === 'manual') {
    await db
      .delete(scheduledRepositoryQueue)
      .where(eq(scheduledRepositoryQueue.repositoryId, repositoryId))
  }

  void runScanPipeline(scan.id, repository).catch((error) => {
    console.error(`[CodeTend] scan ${scan.id} crashed`, error)
  })
  return scan.id
}

function postgresErrorCode(error: unknown): string | undefined {
  let current: unknown = error
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== 'object' || current === null) return undefined
    const record = current as { code?: unknown; cause?: unknown }
    if (typeof record.code === 'string') return record.code
    current = record.cause
  }
  return undefined
}
