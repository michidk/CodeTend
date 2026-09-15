import '@tanstack/react-start/server-only'

import { and, eq, gte, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  type FindingCounts,
  findingOccurrences,
  findingPatches,
  findings,
  findingValidations,
  type Repository,
  repositories,
  repositoryKnowledge,
  repositorySecurityProfiles,
  type ScanTrigger,
  scannerRuns,
  scanScheduleSettings,
  scans,
  scheduledRepositoryQueue,
} from '@/db/schema'
import { DomainError } from '@/lib/domain-errors'
import { getServerEnv } from '@/lib/env.server'
import {
  type EnrichedScannerFinding,
  OPEN_FINDING_STATES,
  type ScannerResult,
  scannerResultJsonSchema,
} from '@/lib/findings'
import { buildFixPrompt } from '@/lib/fix-prompt'
import { createKeyedLock } from '@/lib/keyed-lock'
import type { ScanProgress } from '@/lib/scan-progress'
import { getScanner, type ScannerDefinition } from '@/lib/scanners'
import {
  calculateOverallScore,
  calculateScannerScore,
  gradeForScore,
} from '@/lib/scoring'
import {
  DEFAULT_SCAN_FILE_GLOB,
  DEFAULT_SCAN_MAX_FILES,
  DEFAULT_SCAN_TARGET,
  type ScanTarget,
} from '@/lib/security-scans'
import {
  cancelEveScanSession,
  startEveScanSession,
} from '@/lib/server/eve-client.server'
import {
  reconcileScannerFindings,
  sumCounts,
} from '@/lib/server/finding-reconciliation.server'
import {
  ensureGitNexusServer,
  removeGitNexusIndex,
} from '@/lib/server/gitnexus.server'
import { sealScanArtifacts } from '@/lib/server/scan-artifacts'
import {
  readScanCheckpoint,
  readScanResult,
  removeScanArtifacts,
  removeScanWorkspace,
  waitForScanResult,
  workspacesDir,
  writeScanRequest,
} from '@/lib/server/scan-files.server'
import {
  readScanUsage,
  removeScanUsage,
  type ScanUsage,
  usageColumns,
} from '@/lib/server/scan-usage.server'
import { listGlobalScanners } from '@/lib/server/scanner-settings'
import { enrichDependencyAudit } from '@/lib/server/vulnerability-enrichment.server'
import { enrichSourceSecurityFinding } from '@/lib/vulnerabilities'

const ACTIVE_SCAN_STATUSES = ['queued', 'running'] as const
const SCAN_TIMEOUT_MS = 3 * 60 * 60_000
// Live events, polling, and recovery can observe the same checkpoint at once.
// Serialize their reconciliation with the final result for each scan.
const withScanPersistenceLock = createKeyedLock<number>()

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
    readonly maxFiles?: number
    readonly fileGlob?: string
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

  if (env.TECDEBT_MAX_DAILY_COST_USD !== undefined) {
    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)
    const [[scanUsage], [patchUsage]] = await Promise.all([
      db
        .select({
          cost: sql<number>`coalesce(sum(${scans.estimatedCostUsd}), 0)::float8`,
        })
        .from(scans)
        .where(gte(scans.createdAt, today)),
      db
        .select({
          cost: sql<number>`coalesce(sum(${findingPatches.estimatedCostUsd}), 0)::float8`,
        })
        .from(findingPatches)
        .where(gte(findingPatches.createdAt, today)),
    ])
    if (
      (scanUsage?.cost ?? 0) + (patchUsage?.cost ?? 0) >=
      env.TECDEBT_MAX_DAILY_COST_USD
    ) {
      if (trigger === 'manual') {
        throw new DomainError(
          'conflict',
          'The daily AI-cost budget has been reached.',
        )
      }
      return null
    }
  }

  const globalSettings = await db.query.scanScheduleSettings.findFirst({
    where: eq(scanScheduleSettings.id, 1),
    columns: { maxFiles: true, fileGlob: true },
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
        maxFiles:
          options.maxFiles ??
          globalSettings?.maxFiles ??
          DEFAULT_SCAN_MAX_FILES,
        fileGlob:
          options.fileGlob ??
          globalSettings?.fileGlob ??
          DEFAULT_SCAN_FILE_GLOB,
        maxCostUsd:
          options.maxCostUsd ?? env.TECDEBT_DEFAULT_SCAN_COST_USD ?? null,
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

async function setProgress(scanId: number, progress: ScanProgress) {
  await db
    .update(scans)
    .set({ phase: progress.phase, progress })
    .where(and(eq(scans.id, scanId), isNull(scans.cancellationRequestedAt)))
}

async function throwIfCancellationRequested(scanId: number): Promise<void> {
  const scan = await db.query.scans.findFirst({
    where: eq(scans.id, scanId),
    columns: { cancellationRequestedAt: true },
  })
  if (scan?.cancellationRequestedAt) throw new ScanCancelledError()
}

class ScanCancelledError extends Error {
  constructor() {
    super('Scan cancellation was requested.')
    this.name = 'ScanCancelledError'
  }
}

/**
 * fresh clone → GitNexus refresh → knowledge refresh → Eve scanners →
 * structured findings → reconcile → score → fix prompts → persist.
 * The clone, GitNexus and agent steps run inside Eve; this function prepares
 * the request, waits for the durable session and persists the outcome.
 */
async function runScanPipeline(scanId: number, repository: Repository) {
  const env = getServerEnv()
  const startedAt = new Date()
  try {
    await throwIfCancellationRequested(scanId)
    const scanConfiguration = await db.query.scans.findFirst({
      where: eq(scans.id, scanId),
      columns: {
        target: true,
        maxFiles: true,
        fileGlob: true,
        maxCostUsd: true,
      },
    })
    if (!scanConfiguration) throw new Error('Scan configuration disappeared')
    if (await cancellationRequested(scanId)) {
      await cancelScanRecord(scanId, repository.id)
      return
    }
    const claimed = await db
      .update(scans)
      .set({
        status: 'running',
        phase: 'preparing',
        progress: { phase: 'preparing', completed: 0, total: 1 },
        startedAt,
      })
      .where(
        and(
          eq(scans.id, scanId),
          eq(scans.status, 'queued'),
          isNull(scans.cancellationRequestedAt),
        ),
      )
      .returning({ id: scans.id })
    if (claimed.length === 0) {
      await cancelScanRecord(scanId, repository.id)
      return
    }

    const activeScanners = (await listGlobalScanners()).filter(
      (scanner) => scanner.enabled,
    )
    if (activeScanners.length === 0) {
      throw new Error(
        'No scanners are enabled. Enable a scanner and try again.',
      )
    }
    const activeAgentScanners = activeScanners.filter(
      (scanner) => scanner.kind !== 'dependency-audit',
    )

    const gitnexus = env.GITNEXUS_ENABLED ? await ensureGitNexusServer() : false
    await throwIfCancellationRequested(scanId)

    const [knowledge, securityProfile, openFindings] = await Promise.all([
      db.query.repositoryKnowledge.findFirst({
        where: eq(repositoryKnowledge.repositoryId, repository.id),
      }),
      db.query.repositorySecurityProfiles.findFirst({
        where: eq(repositorySecurityProfiles.repositoryId, repository.id),
      }),
      db.query.findings.findMany({
        where: and(
          eq(findings.repositoryId, repository.id),
          or(
            inArray(findings.state, [...OPEN_FINDING_STATES]),
            isNotNull(findings.disposition),
          ),
        ),
      }),
    ])

    await db.insert(scannerRuns).values(
      activeScanners.map((scanner) => ({
        scanId,
        scannerId: scanner.id,
        scannerDefinition: scanner,
        status: 'pending' as const,
      })),
    )

    const previousScan = await db.query.scans.findFirst({
      where: and(
        eq(scans.repositoryId, repository.id),
        inArray(scans.status, ['completed', 'partial']),
      ),
      orderBy: (table, { desc }) => [desc(table.createdAt)],
      columns: { commitSha: true },
    })

    await writeScanRequest({
      scanId,
      previousCommitSha: previousScan?.commitSha ?? null,
      target: scanConfiguration.target,
      maxFiles: scanConfiguration.maxFiles,
      fileGlob: scanConfiguration.fileGlob,
      maxCostUsd: scanConfiguration.maxCostUsd,
      securityProfile: securityProfile?.profile ?? null,
      validation: {
        enabled: env.TECDEBT_VALIDATION_ENABLED,
        runner: env.TECDEBT_VALIDATION_RUNNER,
        image: env.TECDEBT_VALIDATION_IMAGE,
      },
      dependencyAudit: activeScanners.some(
        (scanner) => scanner.kind === 'dependency-audit',
      ),
      repositoryId: repository.id,
      repositoryName: repository.name,
      repositoryUrl: repository.url,
      branch: repository.branch,
      gitnexus,
      knowledge: knowledge
        ? {
            overview: knowledge.overview,
            summary: knowledge.summary,
            sources: knowledge.sources,
            fileCount: knowledge.fileCount,
          }
        : null,
      scanners: activeAgentScanners.map((scanner) => ({
        id: scanner.id,
        name: scanner.name,
        prompt: scanner.prompt,
        hypotheses: openFindings
          .filter((finding) => finding.scannerId === scanner.id)
          .map((finding) => ({
            findingId: finding.id,
            fingerprint: finding.fingerprint,
            title: finding.title,
            severity: finding.severity,
            description: finding.description,
            locations: finding.locations,
            classification: finding.classification,
            securityContext: finding.securityContext,
            disposition: finding.disposition,
            dispositionNote: finding.dispositionNote,
          })),
      })),
      outputSchema: scannerResultJsonSchema,
    })

    await setProgress(scanId, {
      phase: 'starting agent',
      detail: `${activeAgentScanners.length} scanners configured`,
      completed: 0,
      total: 1,
      scannerCompleted: 0,
      scannerTotal: activeAgentScanners.length,
    })
    if (await cancellationRequested(scanId)) {
      await cancelScanRecord(scanId, repository.id)
      return
    }
    await db
      .update(scannerRuns)
      .set({ status: 'running', startedAt: new Date() })
      .where(eq(scannerRuns.scanId, scanId))

    const session = await startEveScanSession(scanId)
    const attached = await db
      .update(scans)
      .set({ eveSessionId: session.sessionId })
      .where(
        and(
          eq(scans.id, scanId),
          inArray(scans.status, [...ACTIVE_SCAN_STATUSES]),
          isNull(scans.cancellationRequestedAt),
        ),
      )
      .returning({ id: scans.id })
    if (attached.length === 0) {
      await cancelEveScanSession(session.sessionId).catch(() => undefined)
      await cancelScanRecord(scanId, repository.id)
      return
    }

    // The live stream drives UI phases, but the result file is the source of
    // truth: Eve's session is durable and keeps running even if this HTTP
    // stream drops, so the scan completes whenever the file appears.
    const ingestCheckpoint = async () => {
      const checkpoint = await readScanCheckpoint(scanId)
      if (checkpoint) {
        await persistScanCheckpoint(scanId, repository, checkpoint)
      }
    }
    const outcome = await Promise.race([
      session
        .settle(async (progress) => {
          await setProgress(scanId, progress)
          await ingestCheckpoint()
        })
        .catch((error) => {
          console.warn(
            `[CodeTend] scan ${scanId}: Eve stream ended early, waiting for the result file`,
            error,
          )
          return waitForScanResult(scanId, SCAN_TIMEOUT_MS).then(() => null)
        }),
      waitForResultWithCheckpoints(scanId, SCAN_TIMEOUT_MS, ingestCheckpoint),
    ])

    const result = await readScanResult(scanId)
    if (await cancellationRequested(scanId)) {
      await cancelScanRecord(scanId, repository.id)
      return
    }
    if (!result) {
      throw new Error(
        outcome?.failure ??
          `Eve finished with status "${outcome?.status ?? 'unknown'}" but wrote no result file.`,
      )
    }

    await throwIfCancellationRequested(scanId)
    await setProgress(scanId, {
      phase: 'reconciling',
      detail: 'Saving findings and scores',
      completed: 1,
      total: 1,
    })
    await persistScanResult(scanId, repository, result)
    await cleanupScanFiles(repository.id, scanId)
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

async function waitForResultWithCheckpoints(
  scanId: number,
  timeoutMs: number,
  ingest: () => Promise<void>,
): Promise<null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if ((await readScanResult(scanId)) !== null) return null
    await ingest()
    await new Promise((resolve) => setTimeout(resolve, 3_000))
  }
  await waitForScanResult(scanId, 1)
  return null
}

async function persistScanCheckpoint(
  scanId: number,
  repository: Repository,
  checkpoint: NonNullable<Awaited<ReturnType<typeof readScanCheckpoint>>>,
) {
  return withScanPersistenceLock(scanId, () =>
    persistScanCheckpointUnlocked(scanId, repository, checkpoint),
  )
}

async function persistScanCheckpointUnlocked(
  scanId: number,
  repository: Repository,
  checkpoint: NonNullable<Awaited<ReturnType<typeof readScanCheckpoint>>>,
) {
  if (checkpoint.scanId !== scanId) return
  const scan = await db.query.scans.findFirst({
    where: eq(scans.id, scanId),
    columns: { target: true },
  })
  if (!scan) return
  const runs = await db.query.scannerRuns.findMany({
    where: eq(scannerRuns.scanId, scanId),
    columns: { scannerId: true, status: true, scannerDefinition: true },
  })
  const pending = new Map(
    runs
      .filter((run) => run.status !== 'completed' && run.status !== 'failed')
      .map((run) => [run.scannerId, run]),
  )
  for (const outcome of checkpoint.scanners) {
    const run = pending.get(outcome.scannerId)
    if (!run) continue
    const scanner = run.scannerDefinition ?? getScanner(run.scannerId)
    if (!scanner) continue
    if (outcome.status !== 'completed' || !outcome.result) {
      await db
        .update(scannerRuns)
        .set({
          status: 'failed',
          error: outcome.error ?? 'Scanner failed.',
          startedAt: new Date(outcome.startedAt),
          finishedAt: new Date(outcome.finishedAt),
        })
        .where(
          and(
            eq(scannerRuns.scanId, scanId),
            eq(scannerRuns.scannerId, scanner.id),
          ),
        )
      continue
    }
    const scannerResult = {
      ...outcome.result,
      findings:
        scanner.id === 'security'
          ? outcome.result.findings.map(enrichSourceSecurityFinding)
          : outcome.result.findings,
    }
    const reconciled = await reconcileScannerFindings({
      repositoryId: repository.id,
      scanId,
      scannerId: scanner.id,
      result: scannerResult,
      authoritative: false,
      coverage: { ...outcome.result.coverage, completeness: 'unknown' },
      target: scan.target,
      targetFiles: checkpoint.targetFiles,
    })
    const openFindings = reconciled.findings.filter((entry) =>
      OPEN_FINDING_STATES.includes(entry.state),
    )
    const score = calculateScannerScore(
      openFindings.map((entry) => entry.finding),
    )
    await db
      .update(scannerRuns)
      .set({
        status: 'completed',
        score,
        summary: scannerResult.summary,
        fixPrompt: buildFixPrompt({
          scanner,
          repositoryName: repository.name,
          repositoryUrl: repository.url,
          branch: repository.branch,
          commitSha: checkpoint.commitSha,
          findings: openFindings.map((entry) => entry.finding),
        }),
        startedAt: new Date(outcome.startedAt),
        finishedAt: new Date(outcome.finishedAt),
      })
      .where(
        and(
          eq(scannerRuns.scanId, scanId),
          eq(scannerRuns.scannerId, scanner.id),
        ),
      )
  }
  await db
    .update(scans)
    .set({
      commitSha: checkpoint.commitSha,
      fileCount: checkpoint.fileCount,
      reviewedFileCount: checkpoint.targetFiles.length,
      targetFileCount: checkpoint.targetFileCount,
      gitnexusUsed: checkpoint.gitnexusUsed,
    })
    .where(and(eq(scans.id, scanId), eq(scans.status, 'running')))
}

async function persistScanResult(
  scanId: number,
  repository: Repository,
  result: Awaited<ReturnType<typeof readScanResult>> & object,
) {
  return withScanPersistenceLock(scanId, () =>
    persistScanResultUnlocked(scanId, repository, result),
  )
}

async function persistScanResultUnlocked(
  scanId: number,
  repository: Repository,
  result: Awaited<ReturnType<typeof readScanResult>> & object,
) {
  const finishedAt = new Date()
  await throwIfCancellationRequested(scanId)
  const usage = await loadScanUsage(scanId)
  const scanConfiguration = await db.query.scans.findFirst({
    where: eq(scans.id, scanId),
    columns: { mode: true, target: true, maxFiles: true, maxCostUsd: true },
  })
  if (!scanConfiguration) throw new Error('Scan configuration disappeared')
  const scannerRunRows = await db.query.scannerRuns.findMany({
    where: eq(scannerRuns.scanId, scanId),
    columns: { scannerId: true, scannerDefinition: true },
  })
  const scannerDefinitions = new Map(
    scannerRunRows.flatMap((run): [string, ScannerDefinition][] => {
      const definition = run.scannerDefinition ?? getScanner(run.scannerId)
      return definition ? [[run.scannerId, definition]] : []
    }),
  )
  const countsPerScanner: FindingCounts[] = []
  const scoreInputs: {
    scanner: { id: string; weight: number }
    score: number | null
  }[] = []
  let failedScanners = 0

  const dependencyScanner = scannerDefinitions.get('vulnerabilities')
  if (dependencyScanner) {
    const dependencyAudit = await persistDependencyAudit({
      scanId,
      repository,
      scanner: dependencyScanner,
      commitSha: result.commitSha,
      audit: result.dependencyAudit,
      finishedAt,
    })
    countsPerScanner.push(dependencyAudit.counts)
    scoreInputs.push(dependencyAudit.scoreInput)
    if (dependencyAudit.failed) failedScanners += 1
  }

  for (const outcome of result.scanners) {
    await throwIfCancellationRequested(scanId)
    const scanner = scannerDefinitions.get(outcome.scannerId)
    if (!scanner) continue

    // A safety-classifier refusal ends the step with no content, so the
    // structured result is either missing or empty. Treating that as a clean
    // scan would silently resolve every open finding in the dimension.
    const refused = (usage?.perScanner.get(scanner.id)?.refusals ?? 0) > 0
    if (outcome.status !== 'completed' || !outcome.result || refused) {
      failedScanners += 1
      await db
        .update(scannerRuns)
        .set({
          status: 'failed',
          error: refused
            ? 'The model declined part of this scan (provider safety filter). Findings were left unchanged.'
            : (outcome.error ?? 'Scanner failed.'),
          startedAt: new Date(outcome.startedAt),
          finishedAt: new Date(outcome.finishedAt),
          ...usageColumns(usage?.perScanner.get(scanner.id)),
        })
        .where(
          and(
            eq(scannerRuns.scanId, scanId),
            eq(scannerRuns.scannerId, scanner.id),
          ),
        )
      scoreInputs.push({ scanner, score: null })
      continue
    }

    const scannerResult: Omit<ScannerResult, 'findings'> & {
      findings: EnrichedScannerFinding[]
    } = {
      ...outcome.result,
      findings:
        scanner.id === 'security'
          ? outcome.result.findings.map(enrichSourceSecurityFinding)
          : outcome.result.findings,
    }
    const reconciled = await reconcileScannerFindings({
      repositoryId: repository.id,
      scanId,
      scannerId: scanner.id,
      result: scannerResult,
      coverage:
        result.targetFiles.length < result.targetFileCount
          ? result.coverage
          : outcome.result.coverage,
      target: scanConfiguration.target,
      targetFiles: result.targetFiles,
    })
    countsPerScanner.push(reconciled.counts)

    const openFindings = reconciled.findings.filter((entry) =>
      OPEN_FINDING_STATES.includes(entry.state),
    )
    const score = calculateScannerScore(
      openFindings.map((entry) => entry.finding),
    )
    scoreInputs.push({ scanner, score })

    const fixPrompt = buildFixPrompt({
      scanner,
      repositoryName: repository.name,
      repositoryUrl: repository.url,
      branch: repository.branch,
      commitSha: result.commitSha,
      findings: openFindings.map((entry) => entry.finding),
    })

    await db
      .update(scannerRuns)
      .set({
        status: 'completed',
        score,
        summary: scannerResult.summary,
        fixPrompt,
        startedAt: new Date(outcome.startedAt),
        finishedAt: new Date(outcome.finishedAt),
        ...usageColumns(usage?.perScanner.get(scanner.id)),
      })
      .where(
        and(
          eq(scannerRuns.scanId, scanId),
          eq(scannerRuns.scannerId, scanner.id),
        ),
      )
  }

  const knowledgeAuthoritative =
    scanConfiguration.target.kind === 'repository' &&
    result.targetFiles.length === result.targetFileCount
  if (knowledgeAuthoritative && result.knowledge.overview.trim().length > 0) {
    await db
      .insert(repositoryKnowledge)
      .values({
        repositoryId: repository.id,
        overview: result.knowledge.overview,
        summary: result.knowledge.summary,
        sources: [...result.knowledge.sources],
        dependencyGraph: result.knowledge.dependencyGraph,
        commitSha: result.commitSha,
        fileCount: result.fileCount,
        refreshedAt: result.knowledge.refreshed ? finishedAt : undefined,
      })
      .onConflictDoUpdate({
        target: repositoryKnowledge.repositoryId,
        set: {
          overview: result.knowledge.overview,
          summary: result.knowledge.summary,
          sources: [...result.knowledge.sources],
          dependencyGraph: result.knowledge.dependencyGraph,
          commitSha: result.commitSha,
          fileCount: result.fileCount,
          updatedAt: finishedAt,
          ...(result.knowledge.refreshed ? { refreshedAt: finishedAt } : {}),
        },
      })
  }

  if (result.securityProfile.generated) {
    await db
      .insert(repositorySecurityProfiles)
      .values({
        repositoryId: repository.id,
        profile: result.securityProfile.profile,
        source: 'generated',
        generatedAt: finishedAt,
      })
      .onConflictDoUpdate({
        target: repositorySecurityProfiles.repositoryId,
        set: {
          profile: result.securityProfile.profile,
          source: 'generated',
          generatedAt: finishedAt,
          version: sql`${repositorySecurityProfiles.version} + 1`,
          updatedAt: finishedAt,
        },
      })
  }

  await persistFindingValidations({
    repositoryId: repository.id,
    scanId,
    validations: result.validations,
  })
  await throwIfCancellationRequested(scanId)

  const overallScore = calculateOverallScore(scoreInputs)
  const counts = sumCounts(countsPerScanner)
  const allFailed =
    scannerDefinitions.size > 0 && failedScanners === scannerDefinitions.size
  const incompleteCoverage = result.coverage.completeness !== 'complete'
  const costExceeded =
    scanConfiguration.maxCostUsd !== null &&
    usage?.total.estimatedCostUsd !== null &&
    usage?.total.estimatedCostUsd !== undefined &&
    usage.total.estimatedCostUsd > scanConfiguration.maxCostUsd

  await db
    .update(scans)
    .set({
      status: allFailed
        ? 'failed'
        : failedScanners > 0 || incompleteCoverage || costExceeded
          ? 'partial'
          : 'completed',
      phase: 'done',
      progress: {
        phase: 'done',
        completed: 1,
        total: 1,
        scannerCompleted: result.scanners.length,
        scannerTotal: result.scanners.length,
        targetFileCount: result.targetFiles.length,
      },
      commitSha: result.commitSha,
      fileCount: result.fileCount,
      reviewedFileCount: result.targetFiles.length,
      targetFileCount: result.targetFileCount,
      gitnexusUsed: result.gitnexusUsed,
      knowledgeRefreshed: knowledgeAuthoritative && result.knowledge.refreshed,
      overallScore,
      grade: gradeForScore(overallScore),
      counts,
      model: usage?.model ?? null,
      coverage: result.coverage,
      ...usageColumns(usage?.total),
      error: allFailed
        ? 'Every scanner failed.'
        : costExceeded
          ? `The completed scan exceeded its $${scanConfiguration.maxCostUsd?.toFixed(2)} estimated cost limit.`
          : incompleteCoverage
            ? 'Scan coverage is incomplete; review deferred surfaces and open questions.'
            : null,
      finishedAt,
    })
    .where(eq(scans.id, scanId))

  await db
    .update(repositories)
    .set({ lastScanAt: finishedAt, updatedAt: finishedAt })
    .where(eq(repositories.id, repository.id))
  try {
    await sealScanArtifacts(scanId)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown artifact error.'
    console.error(`[CodeTend] scan ${scanId}: artifact sealing failed`, error)
    await db
      .update(scans)
      .set({
        status: 'partial',
        error: `Scan completed, but portable artifacts could not be sealed: ${message}`,
      })
      .where(eq(scans.id, scanId))
  }
  await discardScanUsage(usage)
}

async function persistFindingValidations(input: {
  readonly repositoryId: number
  readonly scanId: number
  readonly validations: readonly {
    scannerId: string
    fingerprint: string
    status:
      | 'not_run'
      | 'confirmed'
      | 'not_reproduced'
      | 'inconclusive'
      | 'unavailable'
      | 'error'
    method: string
    summary: string
    commands: readonly {
      command: string
      purpose: string
      timeoutSeconds: number
      exitCode: number | null
      stdout: string
      stderr: string
      timedOut: boolean
      durationMs: number
    }[]
    proofGaps: readonly string[]
    runner: string
  }[]
}) {
  if (input.validations.length === 0) return
  const currentFindings = await db.query.findings.findMany({
    where: eq(findings.repositoryId, input.repositoryId),
    columns: { id: true, scannerId: true, fingerprint: true },
  })
  const occurrences = await db.query.findingOccurrences.findMany({
    where: eq(findingOccurrences.scanId, input.scanId),
    columns: { id: true, findingId: true },
  })
  const occurrenceByFinding = new Map(
    occurrences.map((occurrence) => [occurrence.findingId, occurrence.id]),
  )
  const findingByIdentity = new Map(
    currentFindings.map((finding) => [
      `${finding.scannerId}\u0000${finding.fingerprint}`,
      finding,
    ]),
  )
  const rows = input.validations.flatMap((validation) => {
    const finding = findingByIdentity.get(
      `${validation.scannerId}\u0000${validation.fingerprint}`,
    )
    return finding
      ? [
          {
            findingId: finding.id,
            occurrenceId: occurrenceByFinding.get(finding.id) ?? null,
            status: validation.status,
            method: validation.method,
            summary: validation.summary,
            commands: [...validation.commands],
            proofGaps: [...validation.proofGaps],
            runner: validation.runner,
          },
        ]
      : []
  })
  if (rows.length > 0) await db.insert(findingValidations).values(rows)
}

async function persistDependencyAudit(input: {
  readonly scanId: number
  readonly repository: Repository
  readonly scanner: ScannerDefinition
  readonly commitSha: string
  readonly audit: NonNullable<
    Awaited<ReturnType<typeof readScanResult>>
  >['dependencyAudit']
  readonly finishedAt: Date
}): Promise<{
  readonly counts: FindingCounts
  readonly scoreInput: {
    readonly scanner: { readonly id: string; readonly weight: number }
    readonly score: number | null
  }
  readonly failed: boolean
}> {
  const scanner = input.scanner

  let failed =
    input.audit.status !== 'completed' || input.audit.report === undefined
  let error = failed
    ? (input.audit.error ?? 'OSV dependency audit did not return a report.')
    : null
  let summary = error ?? ''
  let freshFindings: EnrichedScannerFinding[] = []

  if (!failed && input.audit.report !== undefined) {
    try {
      const enriched = await enrichDependencyAudit({
        report: input.audit.report,
        workspaceRoot: `${workspacesDir()}/repo-${input.repository.id}-scan-${input.scanId}`,
      })
      freshFindings = enriched.findings
      summary = enriched.summary
    } catch (auditError) {
      failed = true
      error =
        auditError instanceof Error ? auditError.message : String(auditError)
      summary = `Dependency audit could not be interpreted: ${error}`
    }
  }

  const reconciled = await reconcileScannerFindings({
    repositoryId: input.repository.id,
    scanId: input.scanId,
    scannerId: scanner.id,
    result: {
      summary,
      findings: freshFindings,
      hypothesisVerdicts: [],
      coverage: {
        completeness: failed ? 'unknown' : 'complete',
        reviewed: failed
          ? []
          : ['Supported dependency manifests and lockfiles'],
        deferred: [],
        excluded: [],
        openQuestions: failed ? [error ?? 'Dependency audit failed.'] : [],
      },
    },
    authoritative: !failed,
  })
  const openFindings = reconciled.findings.filter((entry) =>
    OPEN_FINDING_STATES.includes(entry.state),
  )
  const score = failed
    ? null
    : calculateScannerScore(openFindings.map((entry) => entry.finding))
  const fixPrompt = buildFixPrompt({
    scanner,
    repositoryName: input.repository.name,
    repositoryUrl: input.repository.url,
    branch: input.repository.branch,
    commitSha: input.commitSha,
    findings: openFindings.map((entry) => entry.finding),
  })

  await db
    .update(scannerRuns)
    .set({
      status: failed ? 'failed' : 'completed',
      score,
      summary,
      fixPrompt,
      error,
      startedAt: input.finishedAt,
      finishedAt: input.finishedAt,
    })
    .where(
      and(
        eq(scannerRuns.scanId, input.scanId),
        eq(scannerRuns.scannerId, scanner.id),
      ),
    )

  return {
    counts: reconciled.counts,
    scoreInput: { scanner, score },
    failed,
  }
}

/**
 * Recovery after an app restart. Eve sessions are durable, so a scan that was
 * running when the app stopped usually still finishes and writes its result
 * file. Scans with a result file are persisted; scans without one that are
 * older than the grace period are marked failed; younger ones are re-attached
 * by waiting for their result file.
 */
const ORPHAN_GRACE_MS = 30 * 60_000

export async function recoverInterruptedScans(): Promise<void> {
  const active = await db.query.scans.findMany({
    where: inArray(scans.status, [...ACTIVE_SCAN_STATUSES]),
    with: { repository: true },
  })
  for (const scan of active) {
    void adoptScan(scan.id, scan.repository, scan.createdAt).catch((error) =>
      console.error(`[CodeTend] failed to recover scan ${scan.id}`, error),
    )
  }
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
    await setProgress(scanId, {
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
    await cancelEveScanSession(scan.eveSessionId)
  } catch (error) {
    console.warn(
      `[CodeTend] Eve cancellation request failed for scan ${scanId}; the pipeline will stop at its next checkpoint`,
      error,
    )
  }
}

async function cancellationRequested(scanId: number): Promise<boolean> {
  const scan = await db.query.scans.findFirst({
    where: eq(scans.id, scanId),
    columns: { cancellationRequestedAt: true },
  })
  return Boolean(scan?.cancellationRequestedAt)
}

async function cancelScanRecord(scanId: number, repositoryId: number) {
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

async function failScan(scanId: number, repositoryId: number, message: string) {
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

async function cleanupScanFiles(repositoryId: number, scanId: number) {
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
async function loadScanUsage(scanId: number): Promise<ScanUsage | null> {
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
async function discardScanUsage(usage: ScanUsage | null): Promise<void> {
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
