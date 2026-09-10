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
  scans,
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
import { agentScanners, enabledScanners, getScanner } from '@/lib/scanners'
import { computeNextScanAt } from '@/lib/schedule'
import {
  calculateOverallScore,
  calculateScannerScore,
  gradeForScore,
} from '@/lib/scoring'
import {
  DEFAULT_SCAN_TARGET,
  type ScanMode,
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
import { enrichDependencyAudit } from '@/lib/server/vulnerability-enrichment.server'
import { enrichSourceSecurityFinding } from '@/lib/vulnerabilities'

const ACTIVE_SCAN_STATUSES = ['queued', 'running'] as const
const SCAN_TIMEOUT_MS = 3 * 60 * 60_000

/**
 * Creates a scan row for a repository and starts the pipeline in the
 * background. Returns null when a scan is already active for the repository,
 * which is how concurrent scans of the same repository are prevented.
 */
export async function startScan(
  repositoryId: number,
  trigger: ScanTrigger,
  options: {
    readonly mode?: ScanMode
    readonly target?: ScanTarget
    readonly maxCostUsd?: number | null
  } = {},
): Promise<number | null> {
  const repository = await db.query.repositories.findFirst({
    where: eq(repositories.id, repositoryId),
  })
  if (!repository) throw new Error('Repository not found')

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

  let scan: { id: number } | undefined
  try {
    const inserted = await db
      .insert(scans)
      .values({
        repositoryId,
        trigger,
        mode: options.mode ?? 'standard',
        target: options.target ?? DEFAULT_SCAN_TARGET,
        maxCostUsd:
          options.maxCostUsd ?? env.TECDEBT_DEFAULT_SCAN_COST_USD ?? null,
        status: 'queued',
        phase: 'queued',
        branch: repository.branch,
      })
      .returning({ id: scans.id })
    scan = inserted[0]
  } catch (error) {
    if (postgresErrorCode(error) === '23505') return null
    throw error
  }
  if (!scan) throw new Error('Failed to create scan')

  // Always advance the schedule, even for manual scans, so a manual scan
  // never causes a second scheduled scan immediately afterwards.
  await db
    .update(repositories)
    .set({
      nextScanAt: repository.enabled
        ? computeNextScanAt(repository.cronExpression, new Date())
        : null,
      updatedAt: new Date(),
    })
    .where(eq(repositories.id, repositoryId))

  void runScanPipeline(scan.id, repository).catch((error) => {
    console.error(`[tecdebt] scan ${scan.id} crashed`, error)
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

async function setPhase(scanId: number, phase: string) {
  await db
    .update(scans)
    .set({ phase })
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
      columns: { mode: true, target: true, maxCostUsd: true },
    })
    if (!scanConfiguration) throw new Error('Scan configuration disappeared')
    if (await cancellationRequested(scanId)) {
      await cancelScanRecord(scanId, repository.id)
      return
    }
    const claimed = await db
      .update(scans)
      .set({ status: 'running', phase: 'preparing', startedAt })
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
      enabledScanners.map((scanner) => ({
        scanId,
        scannerId: scanner.id,
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
      mode: scanConfiguration.mode,
      target: scanConfiguration.target,
      maxCostUsd: scanConfiguration.maxCostUsd,
      securityProfile: securityProfile?.profile ?? null,
      deep: {
        workers: env.TECDEBT_DEEP_WORKERS,
        maxDiscoveryRuns: env.TECDEBT_DEEP_MAX_RUNS,
        stopAfterNoNew: env.TECDEBT_DEEP_STOP_AFTER_NO_NEW,
      },
      validation: {
        enabled: env.TECDEBT_VALIDATION_ENABLED,
        runner: env.TECDEBT_VALIDATION_RUNNER,
        image: env.TECDEBT_VALIDATION_IMAGE,
      },
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
      scanners: agentScanners.map((scanner) => ({
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

    await setPhase(scanId, 'starting agent')
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
    const outcome = await Promise.race([
      session
        .settle((phase) => setPhase(scanId, phase))
        .catch((error) => {
          console.warn(
            `[tecdebt] scan ${scanId}: Eve stream ended early, waiting for the result file`,
            error,
          )
          return waitForScanResult(scanId, SCAN_TIMEOUT_MS).then(() => null)
        }),
      waitForScanResult(scanId, SCAN_TIMEOUT_MS).then(() => null),
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
    await setPhase(scanId, 'reconciling')
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

async function persistScanResult(
  scanId: number,
  repository: Repository,
  result: Awaited<ReturnType<typeof readScanResult>> & object,
) {
  const finishedAt = new Date()
  await throwIfCancellationRequested(scanId)
  const usage = await loadScanUsage(scanId)
  const scanConfiguration = await db.query.scans.findFirst({
    where: eq(scans.id, scanId),
    columns: { mode: true, target: true, maxCostUsd: true },
  })
  if (!scanConfiguration) throw new Error('Scan configuration disappeared')
  const countsPerScanner: FindingCounts[] = []
  const scoreInputs: {
    scanner: { id: string; weight: number }
    score: number | null
  }[] = []
  let failedScanners = 0

  const dependencyAudit = await persistDependencyAudit({
    scanId,
    repository,
    commitSha: result.commitSha,
    audit: result.dependencyAudit,
    finishedAt,
  })
  countsPerScanner.push(dependencyAudit.counts)
  scoreInputs.push(dependencyAudit.scoreInput)
  if (dependencyAudit.failed) failedScanners += 1

  for (const outcome of result.scanners) {
    await throwIfCancellationRequested(scanId)
    const scanner = getScanner(outcome.scannerId)
    if (!scanner) continue

    if (outcome.status !== 'completed' || !outcome.result) {
      failedScanners += 1
      await db
        .update(scannerRuns)
        .set({
          status: 'failed',
          error: outcome.error ?? 'Scanner failed.',
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
      coverage: outcome.result.coverage,
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

  if (result.knowledge.overview.trim().length > 0) {
    await db
      .insert(repositoryKnowledge)
      .values({
        repositoryId: repository.id,
        overview: result.knowledge.overview,
        summary: result.knowledge.summary,
        sources: [...result.knowledge.sources],
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
      .onConflictDoNothing()
  }

  await persistFindingValidations({
    repositoryId: repository.id,
    scanId,
    validations: result.validations,
  })
  await throwIfCancellationRequested(scanId)

  const overallScore = calculateOverallScore(scoreInputs)
  const counts = sumCounts(countsPerScanner)
  const allFailed = failedScanners === enabledScanners.length
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
      commitSha: result.commitSha,
      fileCount: result.fileCount,
      gitnexusUsed: result.gitnexusUsed,
      knowledgeRefreshed: result.knowledge.refreshed,
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
    console.error(`[tecdebt] scan ${scanId}: artifact sealing failed`, error)
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
  const scanner = getScanner('vulnerabilities')
  if (!scanner) throw new Error('Vulnerable Dependencies scanner is missing')

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
      console.error(`[tecdebt] failed to recover scan ${scan.id}`, error),
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
    if ((await readScanResult(scanId)) === null) {
      if (Date.now() - createdAt.getTime() > ORPHAN_GRACE_MS) {
        throw new Error(
          'The application restarted while this scan was running.',
        )
      }
      await waitForScanResult(scanId, Math.max(remaining, 60_000))
    }
    const result = await readScanResult(scanId)
    if (!result) throw new Error('Scan result file disappeared.')
    await setPhase(scanId, 'reconciling')
    await persistScanResult(scanId, repository, result)
    await cleanupScanFiles(repository.id, scanId)
    console.info(`[tecdebt] recovered scan ${scanId} after restart`)
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
      `[tecdebt] Eve cancellation request failed for scan ${scanId}; the pipeline will stop at its next checkpoint`,
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
      `[tecdebt] failed to remove GitNexus index for scan ${scanId}`,
      error,
    )
  }
  try {
    await Promise.all([
      removeScanWorkspace(repositoryId, scanId),
      removeScanArtifacts(scanId),
    ])
  } catch (error) {
    console.warn(`[tecdebt] failed to clean up files for scan ${scanId}`, error)
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
    console.warn(`[tecdebt] failed to read usage for scan ${scanId}`, error)
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
      `[tecdebt] failed to remove usage file ${usage.rootSessionId}`,
      error,
    )
  }
}
