import '@tanstack/react-start/server-only'

import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  type FindingCounts,
  findingOccurrences,
  findings,
  findingValidations,
  type Repository,
  repositories,
  repositoryKnowledge,
  repositorySecurityProfiles,
  scannerRuns,
  scans,
} from '@/db/schema'
import {
  type EnrichedScannerFinding,
  OPEN_FINDING_STATES,
  type ScannerResult,
} from '@/lib/findings'
import { buildFixPrompt } from '@/lib/fix-prompt'
import { getScanner, type ScannerDefinition } from '@/lib/scanners'
import {
  calculateOverallScore,
  calculateScannerScore,
  gradeForScore,
} from '@/lib/scoring'
import {
  reconcileScannerFindings,
  sumCounts,
} from '@/lib/server/finding-reconciliation.server'
import { sealScanArtifacts } from '@/lib/server/scan-artifacts'
import {
  type readScanCheckpoint,
  type readScanResult,
  workspacesDir,
} from '@/lib/server/scan-files.server'
import {
  discardScanUsage,
  loadScanUsage,
} from '@/lib/server/scan-recovery.server'
import {
  throwIfCancellationRequested,
  withScanPersistenceLock,
} from '@/lib/server/scan-runtime.server'
import { usageColumns } from '@/lib/server/scan-usage.server'
import { enrichDependencyAudit } from '@/lib/server/vulnerability-enrichment.server'
import { enrichSourceSecurityFinding } from '@/lib/vulnerabilities'

export async function persistScanCheckpoint(
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
      target: scan.target,
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
        investigation: scannerResult.investigation,
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
      gitnexusUsed: checkpoint.gitnexusUsed,
    })
    .where(and(eq(scans.id, scanId), eq(scans.status, 'running')))
}

export async function persistScanResult(
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
    columns: {
      target: true,
      maxCostUsd: true,
    },
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
  const { countsPerScanner, scoreInputs, failedScanners } =
    await persistScannerOutcomes({
      scanId,
      repository,
      result,
      finishedAt,
      usage,
      scanConfiguration,
      scannerDefinitions,
    })
  const knowledgeAuthoritative = scanConfiguration.target.kind === 'repository'
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
  const costExceeded =
    scanConfiguration.maxCostUsd !== null &&
    usage?.total.estimatedCostUsd !== null &&
    usage?.total.estimatedCostUsd !== undefined &&
    usage.total.estimatedCostUsd > scanConfiguration.maxCostUsd
  // Total usage also includes orchestration, knowledge, and post-processing.
  // The input-token budget controls scanner effort; exceeding the final total
  // therefore does not make an otherwise successful scan partial.
  await db
    .update(scans)
    .set({
      status: allFailed
        ? 'failed'
        : failedScanners > 0 || costExceeded
          ? 'partial'
          : 'completed',
      phase: 'done',
      progress: {
        phase: 'done',
        completed: 1,
        total: 1,
        scannerCompleted: result.scanners.length,
        scannerTotal: result.scanners.length,
      },
      commitSha: result.commitSha,
      fileCount: result.fileCount,
      gitnexusUsed: result.gitnexusUsed,
      knowledgeRefreshed: knowledgeAuthoritative && result.knowledge.refreshed,
      overallScore,
      grade: gradeForScore(overallScore),
      counts,
      model: usage?.model ?? null,
      investigation: result.investigation,
      coverage: result.coverage,
      ...usageColumns(usage?.total),
      error: allFailed
        ? 'Every scanner failed.'
        : costExceeded
          ? `The completed scan exceeded its $${scanConfiguration.maxCostUsd?.toFixed(2)} estimated cost limit.`
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

async function persistScannerOutcomes(input: {
  readonly scanId: number
  readonly repository: Repository
  readonly result: NonNullable<Awaited<ReturnType<typeof readScanResult>>>
  readonly finishedAt: Date
  readonly usage: Awaited<ReturnType<typeof loadScanUsage>>
  readonly scanConfiguration: Pick<
    typeof scans.$inferSelect,
    'target' | 'maxCostUsd'
  >
  readonly scannerDefinitions: ReadonlyMap<string, ScannerDefinition>
}) {
  const countsPerScanner: FindingCounts[] = []
  const scoreInputs: {
    scanner: { id: string; weight: number }
    score: number | null
  }[] = []
  let failedScanners = 0

  const dependencyScanner = input.scannerDefinitions.get('vulnerabilities')
  if (dependencyScanner) {
    const dependencyAudit = await persistDependencyAudit({
      scanId: input.scanId,
      repository: input.repository,
      scanner: dependencyScanner,
      commitSha: input.result.commitSha,
      audit: input.result.dependencyAudit,
      finishedAt: input.finishedAt,
    })
    countsPerScanner.push(dependencyAudit.counts)
    scoreInputs.push(dependencyAudit.scoreInput)
    if (dependencyAudit.failed) failedScanners += 1
  }

  for (const outcome of input.result.scanners) {
    await throwIfCancellationRequested(input.scanId)
    const scanner = input.scannerDefinitions.get(outcome.scannerId)
    if (!scanner) continue

    const refused = (input.usage?.perScanner.get(scanner.id)?.refusals ?? 0) > 0
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
          ...usageColumns(input.usage?.perScanner.get(scanner.id)),
        })
        .where(
          and(
            eq(scannerRuns.scanId, input.scanId),
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
      repositoryId: input.repository.id,
      scanId: input.scanId,
      scannerId: scanner.id,
      result: scannerResult,
      target: input.scanConfiguration.target,
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
      repositoryName: input.repository.name,
      repositoryUrl: input.repository.url,
      branch: input.repository.branch,
      commitSha: input.result.commitSha,
      findings: openFindings.map((entry) => entry.finding),
    })

    await db
      .update(scannerRuns)
      .set({
        status: 'completed',
        score,
        summary: scannerResult.summary,
        investigation: scannerResult.investigation,
        fixPrompt,
        startedAt: new Date(outcome.startedAt),
        finishedAt: new Date(outcome.finishedAt),
        ...usageColumns(input.usage?.perScanner.get(scanner.id)),
      })
      .where(
        and(
          eq(scannerRuns.scanId, input.scanId),
          eq(scannerRuns.scannerId, scanner.id),
        ),
      )
  }

  return { countsPerScanner, scoreInputs, failedScanners }
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
      investigation: {
        strategy:
          'Deterministically inspected supported dependency manifests and lockfiles with OSV.',
        focusAreas: [
          { kind: 'repository', aspect: 'declared and locked dependencies' },
        ],
        evidence: [],
        blindSpots: failed ? [error ?? 'Dependency audit failed.'] : [],
        confidence: failed ? 'low' : 'high',
      },
      coverage: {
        completeness: failed ? 'unknown' : 'complete',
        reviewed: [],
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
      investigation: {
        strategy:
          'Deterministically inspected supported dependency manifests and lockfiles with OSV.',
        focusAreas: [
          { kind: 'repository', aspect: 'declared and locked dependencies' },
        ],
        evidence: [],
        blindSpots: failed ? [error ?? 'Dependency audit failed.'] : [],
        confidence: failed ? 'low' : 'high',
      },
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
