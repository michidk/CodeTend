import { defineWorkflowTool } from 'eve/tools'
import { z } from 'zod'
import { scannerResultSchema } from '@/lib/findings'
import type {
  DependencyAuditResult,
  InvestigationReport,
  KnowledgeResult,
  ScanCheckpoint,
  ScanCoverage,
  ScannerOutcome,
  ScanRequest,
  ScanRequestScanner,
  ScanResult,
  SecurityProfile,
  WorkspaceManifest,
} from '../lib/contract'
import { UNAVAILABLE_DEPENDENCY_GRAPH } from '../lib/dependency-graph'
import {
  applyDependencyImpactReviews,
  type DependencyImpactReview,
  dependencyImpactCandidates,
  dependencyImpactReviewBatches,
  dependencyImpactReviewJsonSchema,
  dependencyImpactReviewMessage,
  dependencyImpactReviewSchema,
} from '../lib/dependency-security-review'
import type { JsonObject } from '../lib/json'
import {
  assessKnowledgeStaleness,
  type KnowledgeAgentOutput,
  knowledgeAgentMessage,
  knowledgeOutputSchema,
} from '../lib/knowledge'
import { sandboxRepoPath } from '../lib/paths'
import { scannerAgentMessage } from '../lib/scanner-message'
import {
  applyExploitabilityReview,
  type ExploitabilityReview,
  exploitabilityReviewJsonSchema,
  exploitabilityReviewMessage,
  exploitabilityReviewSchema,
} from '../lib/security-review'
import {
  auditDependencies,
  cloneRepository,
  extractSubsystemDependencyGraph,
  indexWithGitNexus,
  nowIso,
  readScanCheckpoint,
  readScanRequest,
  resolveDiffTargetFiles,
  validateCandidates,
  writeScanCheckpoint,
  writeScanResult,
} from '../lib/steps'

const SCANNER_ATTEMPTS = 2
const configuredConcurrency = Number.parseInt(
  process.env.TECDEBT_SCANNER_CONCURRENCY ?? '',
  10,
)
const SCANNER_CONCURRENCY =
  Number.isFinite(configuredConcurrency) && configuredConcurrency > 0
    ? Math.min(configuredConcurrency, 8)
    : 4

interface Progress {
  readonly phase: string
  readonly detail?: string
  readonly scanId?: number
  readonly commitSha?: string
  readonly completed: number
  readonly total: number
  readonly scannerCompleted?: number
  readonly scannerTotal?: number
  readonly completedScanners?: number
  readonly failed?: number
}

/**
 * The durable scan pipeline. Each `"use step"` function is checkpointed by
 * Eve; the subagent calls are durable too, so a crashed process resumes from
 * the last completed scanner instead of restarting the scan.
 */
export default defineWorkflowTool({
  description:
    'Run a bounded repository health investigation for a scan id prepared by the CodeTend app. Clones the repository, refreshes repository knowledge, runs every specialized scanner and writes the result file.',
  inputSchema: z.object({ scanId: z.number().int().positive() }),
  label: {
    start: ({ scanId }) => `Scan #${scanId}`,
    delta: (_input, partial: Progress) => partial.phase,
  },
  async *execute({ scanId }, ctx) {
    'use workflow'

    const request: ScanRequest = await readScanRequest(scanId)
    const requestFingerprint = fingerprintScanRequest(request)
    const total = totalScanSteps(request)
    let completed = 0

    const cloning: Progress = {
      phase: 'cloning',
      detail: `${request.repositoryUrl}#${request.branch}`,
      completed,
      total,
      scannerCompleted: 0,
      scannerTotal: request.scanners.length,
    }
    yield cloning
    const workspace = await cloneRepository(request)
    completed += 1
    const repoPath = sandboxRepoPath(workspace.name)
    const scanTarget = request.target
    const diffTargetFiles =
      scanTarget.kind === 'diff'
        ? new Set(await resolveDiffTargetFiles(request, workspace))
        : null
    const scanners = filterScannersForTarget(
      request,
      scanTarget,
      diffTargetFiles,
    )

    let dependencyAudit: DependencyAuditResult = {
      status: 'unavailable',
      error: 'The dependency scanner was disabled for this scan.',
      exploitabilityAssessments: [],
    }
    // Requests from an older app omit this flag and retain the old enabled
    // behavior during rolling deployments.
    if (request.dependencyAudit !== false) {
      const auditing: Progress = {
        phase: 'dependency audit',
        detail: 'Checking dependency lockfiles with OSV',
        completed,
        total,
        scannerCompleted: 0,
        scannerTotal: scanners.length,
      }
      yield auditing
      dependencyAudit = await auditDependencies(workspace)
      completed += 1
    }

    let gitnexusRepo: string | null = null
    if (request.gitnexus) {
      const indexing: Progress = {
        phase: 'indexing',
        detail: 'Building the GitNexus code index',
        completed,
        total,
        scannerCompleted: 0,
        scannerTotal: scanners.length,
      }
      yield indexing
      const indexed = await indexWithGitNexus(workspace)
      if (indexed.ok) gitnexusRepo = workspace.name
      completed += 1
    }

    const knowledgePhase: Progress = {
      phase: 'knowledge',
      detail: 'Refreshing repository architecture knowledge',
      completed,
      total,
      scannerCompleted: 0,
      scannerTotal: scanners.length,
    }
    yield knowledgePhase
    const knowledgeBase = await refreshKnowledge({
      request,
      workspace,
      repoPath,
      gitnexusRepo,
      runAgent: (message) =>
        ctx.agent('knowledge', {
          message,
          outputSchema: knowledgeOutputSchema,
        }),
    })
    completed += 1

    const dependencyGraphPhase: Progress = {
      phase: 'dependency graph',
      detail: 'Mapping subsystem dependencies',
      completed,
      total,
      scannerCompleted: 0,
      scannerTotal: scanners.length,
    }
    yield dependencyGraphPhase
    const dependencyGraph =
      gitnexusRepo && knowledgeBase.summary.subsystems.length > 0
        ? await extractSubsystemDependencyGraph(
            gitnexusRepo,
            knowledgeBase.summary.subsystems,
          )
        : UNAVAILABLE_DEPENDENCY_GRAPH
    completed += 1
    const knowledge: KnowledgeResult = { ...knowledgeBase, dependencyGraph }

    const securityProfile =
      (knowledge.refreshed
        ? knowledge.summary.securityProfile
        : request.securityProfile) ?? securityProfileFromKnowledge(knowledge)

    // Every scanner is an independent subagent session; one failing scanner
    // never discards the others' results.
    const priorCheckpoint = await readScanCheckpoint(scanId)
    const checkpointMatches =
      priorCheckpoint?.version === 1 &&
      priorCheckpoint.scanId === scanId &&
      priorCheckpoint.requestFingerprint === requestFingerprint &&
      priorCheckpoint.commitSha === workspace.commitSha
    const outcomes: ScannerOutcome[] = checkpointMatches
      ? [...priorCheckpoint.scanners]
      : []
    const completedScannerIds = new Set(
      outcomes.map((outcome) => outcome.scannerId),
    )
    const remainingScanners = scanners.filter(
      (scanner) => !completedScannerIds.has(scanner.id),
    )
    for (
      let start = 0;
      start < remainingScanners.length;
      start += SCANNER_CONCURRENCY
    ) {
      const batch = remainingScanners.slice(start, start + SCANNER_CONCURRENCY)
      yield {
        phase: 'scanning',
        detail: `Running ${batch.map((scanner) => scanner.name).join(', ')}`,
        completed,
        total,
        scannerCompleted: outcomes.length,
        scannerTotal: scanners.length,
      } satisfies Progress
      const pending = new Map(
        batch.map((scanner) => [
          scanner.id,
          runScanner({
            scanner,
            scanners,
            request,
            workspace,
            knowledge,
            repoPath,
            gitnexusRepo,
            securityProfile,
            runAgent: (message) =>
              ctx.agent('scanner', {
                message,
                outputSchema: request.outputSchema as JsonObject,
              }),
          }),
        ]),
      )
      while (pending.size > 0) {
        const settled = await Promise.race(pending.values())
        pending.delete(settled.scannerId)
        outcomes.push(settled.outcome)
        completed += 1
        const checkpoint: ScanCheckpoint = {
          version: 1,
          scanId,
          requestFingerprint,
          commitSha: workspace.commitSha,
          fileCount: workspace.fileCount,
          gitnexusUsed: gitnexusRepo !== null,
          knowledge,
          securityProfile: {
            profile: securityProfile,
            generated: request.target.kind === 'repository',
          },
          dependencyAudit,
          scanners: outcomes,
          updatedAt: await nowIso(),
        }
        await writeScanCheckpoint(checkpoint)
        yield {
          phase: 'scanning',
          detail: `${outcomes.length} of ${scanners.length} scanners completed; ${pending.size} still running in this batch`,
          completed,
          total,
          scannerCompleted: outcomes.length,
          scannerTotal: scanners.length,
        } satisfies Progress
      }
    }

    const investigation = aggregateInvestigations(outcomes)
    const coverage = aggregateCoverage(outcomes, investigation)
    const candidates = securityValidationCandidates(outcomes)

    const validating: Progress = {
      phase: 'validating',
      detail: `${candidates.length} security candidates to validate`,
      completed,
      total,
      scannerCompleted: outcomes.length,
      scannerTotal: scanners.length,
    }
    yield validating
    const validations = await validateCandidates({
      request,
      workspace,
      candidates,
    })
    completed += 1

    const securityOutcomeIndex = outcomes.findIndex(
      (outcome) => outcome.scannerId === 'security',
    )
    const securityResult =
      securityOutcomeIndex >= 0
        ? asScannerResult(outcomes[securityOutcomeIndex]?.result)
        : null
    if (securityOutcomeIndex >= 0 && securityResult?.findings?.length) {
      const reviewing: Progress = {
        phase: 'reviewing security exploitability',
        detail: `${securityResult.findings.length} security findings to review`,
        completed,
        total,
        scannerCompleted: outcomes.length,
        scannerTotal: scanners.length,
      }
      yield reviewing
      let review: ExploitabilityReview = { assessments: [] }
      try {
        const rawReview = await ctx.agent('scanner', {
          message: exploitabilityReviewMessage({
            repoPath,
            repositoryName: request.repositoryName,
            findings: securityResult.findings,
            validations,
            securityProfile,
            gitnexusRepo,
          }),
          outputSchema: exploitabilityReviewJsonSchema,
        })
        const parsed = exploitabilityReviewSchema.safeParse(rawReview)
        if (parsed.success) review = parsed.data
      } catch {
        // A failed review must not promote unverified findings. The fallback
        // assessment below leaves every finding at low contextual priority.
      }
      outcomes[securityOutcomeIndex] = {
        ...outcomes[securityOutcomeIndex],
        result: applyExploitabilityReview(
          securityResult,
          review,
          workspace.files.map((file) => file.path),
        ),
      } as ScannerOutcome
      completed += 1
    } else if (request.scanners.some((scanner) => scanner.id === 'security')) {
      completed += 1
    }

    if (request.dependencyAudit !== false) {
      let candidates: ReturnType<typeof dependencyImpactCandidates> = []
      if (
        dependencyAudit.status === 'completed' &&
        dependencyAudit.report !== undefined
      ) {
        try {
          candidates = dependencyImpactCandidates(dependencyAudit.report)
        } catch {
          // The deterministic server parser remains authoritative for the
          // audit. If review candidate extraction fails, no finding is
          // promoted without a confirmed repository-specific assessment.
        }
      }
      const reviewingDependencies: Progress = {
        phase: 'reviewing dependency impact',
        detail: `${candidates.length} dependency vulnerability candidates to review`,
        completed,
        total,
        scannerCompleted: outcomes.length,
        scannerTotal: scanners.length,
      }
      yield reviewingDependencies
      const reviews: DependencyImpactReview[] = []
      for (const batch of dependencyImpactReviewBatches(candidates)) {
        try {
          const rawReview = await ctx.agent('scanner', {
            message: dependencyImpactReviewMessage({
              repoPath,
              repositoryName: request.repositoryName,
              candidates: batch,
              securityProfile,
              gitnexusRepo,
            }),
            outputSchema: dependencyImpactReviewJsonSchema,
          })
          const parsed = dependencyImpactReviewSchema.safeParse(rawReview)
          if (parsed.success) reviews.push(parsed.data)
        } catch {
          // Missing batches are converted into not-confirmed assessments.
        }
      }
      dependencyAudit = {
        ...dependencyAudit,
        exploitabilityAssessments: applyDependencyImpactReviews(
          candidates,
          reviews,
          workspace.files.map((file) => file.path),
        ),
      }
      completed += 1
    }

    const persisting: Progress = {
      phase: 'persisting',
      detail: 'Writing the scan result',
      completed,
      total,
      scannerCompleted: outcomes.length,
      scannerTotal: scanners.length,
    }
    yield persisting
    const result: ScanResult = {
      scanId,
      commitSha: workspace.commitSha,
      fileCount: workspace.fileCount,
      gitnexusUsed: gitnexusRepo !== null,
      knowledge,
      securityProfile: {
        profile: securityProfile,
        generated: request.target.kind === 'repository',
      },
      dependencyAudit,
      scanners: outcomes,
      investigation,
      coverage,
      validations,
      finishedAt: await nowIso(),
    }
    await writeScanResult(result)
    completed += 1

    const done: Progress = {
      phase: 'done',
      scanId,
      commitSha: workspace.commitSha,
      completed,
      total,
      scannerCompleted: outcomes.length,
      scannerTotal: scanners.length,
      completedScanners: outcomes.filter(
        (outcome) => outcome.status === 'completed',
      ).length,
      failed: outcomes.filter((outcome) => outcome.status === 'failed').length,
    }
    return done
  },
  toModelOutput(output: Progress) {
    return {
      type: 'text',
      value: `Scan ${output.scanId ?? '?'} finished at ${output.commitSha ?? '?'}: ${output.completedScanners ?? 0} scanners completed, ${output.failed ?? 0} failed.`,
    }
  },
})

function fingerprintScanRequest(request: ScanRequest): string {
  return JSON.stringify({
    repositoryId: request.repositoryId,
    repositoryUrl: request.repositoryUrl,
    branch: request.branch,
    target: request.target,
    maxInputTokens: request.maxInputTokens,
    scanners: request.scanners.map((scanner) => scanner.id),
    dependencyAudit: request.dependencyAudit !== false,
    validation: request.validation,
  })
}

function totalScanSteps(request: ScanRequest): number {
  return (
    5 +
    request.scanners.length +
    (request.dependencyAudit === false ? 0 : 1) +
    (request.dependencyAudit === false ? 0 : 1) +
    (request.gitnexus ? 1 : 0) +
    (request.scanners.some((scanner) => scanner.id === 'security') ? 1 : 0)
  )
}

function filterScannersForTarget(
  request: ScanRequest,
  target: ScanRequest['target'],
  diffTargetFiles: ReadonlySet<string> | null,
): ScanRequestScanner[] {
  return request.scanners.map((scanner) => ({
    ...scanner,
    hypotheses: scanner.hypotheses.filter(
      (hypothesis) =>
        hypothesis.locations.length === 0 ||
        target.kind === 'repository' ||
        (target.kind === 'paths'
          ? hypothesis.locations.some((location) =>
              target.paths.some(
                (scope) =>
                  location.path === scope ||
                  location.path.startsWith(`${scope.replace(/\/$/, '')}/`) ||
                  scope.startsWith(`${location.path.replace(/\/$/, '')}/`),
              ),
            )
          : hypothesis.locations.some((location) =>
              diffTargetFiles?.has(location.path),
            )),
    ),
  }))
}

function securityValidationCandidates(
  outcomes: readonly ScannerOutcome[],
): Parameters<typeof validateCandidates>[0]['candidates'] {
  return outcomes
    .filter((outcome) => outcome.scannerId === 'security')
    .flatMap((outcome) => {
      const result = asScannerResult(outcome.result)
      return (result?.findings ?? [])
        .map((finding) => ({
          scannerId: outcome.scannerId,
          fingerprint: finding.fingerprint,
          validationPlan: finding.validationPlan,
        }))
        .filter((candidate) => candidate.fingerprint.length > 0)
    })
}

async function refreshKnowledge(input: {
  readonly request: ScanRequest
  readonly workspace: WorkspaceManifest
  readonly repoPath: string
  readonly gitnexusRepo: string | null
  readonly runAgent: (message: string) => Promise<unknown>
}): Promise<Omit<KnowledgeResult, 'dependencyGraph'>> {
  const staleness = assessKnowledgeStaleness(
    input.request.knowledge,
    input.workspace,
    input.request.knowledge?.fileCount ?? null,
  )
  if (!staleness.refreshNeeded && input.request.knowledge) {
    return {
      refreshed: false,
      overview: input.request.knowledge.overview,
      summary: input.request.knowledge.summary,
      sources: input.request.knowledge.sources,
      reason: staleness.reason,
    }
  }

  const output = (await input.runAgent(
    knowledgeAgentMessage({
      repoPath: input.repoPath,
      repositoryName: input.request.repositoryName,
      workspace: input.workspace,
      previous: input.request.knowledge,
      staleness,
      gitnexusRepo: input.gitnexusRepo,
      securityProfile: input.request.securityProfile,
    }),
  )) as KnowledgeAgentOutput | null
  return output
    ? {
        refreshed: true,
        overview: output.overview,
        summary: {
          languages: output.languages,
          frameworks: output.frameworks,
          subsystems: output.subsystems,
          concepts: output.concepts,
          securityProfile: output.securityProfile,
        },
        sources: resolveSources(output.sources, input.workspace),
        reason: staleness.reason,
      }
    : {
        refreshed: false,
        overview: input.request.knowledge?.overview ?? '',
        summary: input.request.knowledge?.summary ?? {
          languages: [],
          frameworks: [],
          subsystems: [],
          concepts: [],
        },
        sources: input.request.knowledge?.sources ?? [],
        reason: 'Knowledge agent returned no structured output.',
      }
}

async function runScanner(input: {
  readonly scanner: ScanRequestScanner
  readonly scanners: readonly ScanRequestScanner[]
  readonly request: ScanRequest
  readonly workspace: WorkspaceManifest
  readonly knowledge: KnowledgeResult
  readonly repoPath: string
  readonly gitnexusRepo: string | null
  readonly securityProfile: SecurityProfile
  readonly runAgent: (message: string) => Promise<unknown>
}): Promise<{ scannerId: string; outcome: ScannerOutcome }> {
  const startedAt = await nowIso()
  const message = scannerAgentMessage({
    scanner: input.scanner,
    siblingScanners: input.scanners,
    repoPath: input.repoPath,
    repositoryName: input.request.repositoryName,
    workspace: input.workspace,
    knowledge: input.knowledge,
    gitnexusRepo: input.gitnexusRepo,
    previousCommitSha: input.request.previousCommitSha ?? null,
    target: input.request.target,
    maxInputTokens: Math.max(
      10_000,
      Math.floor(
        input.request.maxInputTokens / Math.max(1, input.scanners.length),
      ),
    ),
    attentionHistory: input.scanner.attentionHistory,
    securityProfile: input.securityProfile,
  })
  try {
    let result: unknown = null
    let lastError: unknown
    // A transient session-start failure gets one bounded retry.
    for (let attempt = 0; attempt < SCANNER_ATTEMPTS; attempt += 1) {
      try {
        result = await input.runAgent(message)
        lastError = undefined
        break
      } catch (error) {
        lastError = error
      }
    }
    if (lastError !== undefined) throw lastError
    return {
      scannerId: input.scanner.id,
      outcome: {
        scannerId: input.scanner.id,
        ...scannerOutput(result),
        startedAt,
        finishedAt: await nowIso(),
      },
    }
  } catch (error) {
    return {
      scannerId: input.scanner.id,
      outcome: {
        scannerId: input.scanner.id,
        status: 'failed',
        error: describeError(error),
        startedAt,
        finishedAt: await nowIso(),
      },
    }
  }
}

function resolveSources(
  paths: readonly string[],
  workspace: { files: readonly { path: string; hash: string }[]; name: string },
): { path: string; hash: string }[] {
  const byPath = new Map(workspace.files.map((file) => [file.path, file.hash]))
  const prefix = `/workspace/repos/${workspace.name}/`
  const seen = new Set<string>()
  const sources: { path: string; hash: string }[] = []
  for (const raw of paths) {
    const normalized = raw.startsWith(prefix)
      ? raw.slice(prefix.length)
      : raw.replace(/^\.?\//, '')
    const hash = byPath.get(normalized)
    if (!hash || seen.has(normalized)) continue
    seen.add(normalized)
    sources.push({ path: normalized, hash })
  }
  return sources
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null) {
    const record = error as { message?: unknown; name?: unknown }
    if (typeof record.message === 'string') {
      return typeof record.name === 'string'
        ? `${record.name}: ${record.message}`
        : record.message
    }
    try {
      return JSON.stringify(error).slice(0, 1000)
    } catch {
      return String(error)
    }
  }
  return String(error)
}

function securityProfileFromKnowledge(
  knowledge: KnowledgeResult,
): NonNullable<ScanRequest['securityProfile']> {
  return (
    knowledge.summary.securityProfile ?? {
      projectOverview: knowledge.overview,
      assets: knowledge.summary.subsystems.map(
        (subsystem) =>
          `${subsystem.name}: ${subsystem.responsibility} (${subsystem.paths.join(', ')})`,
      ),
      entryPoints: [],
      trustBoundaries: [],
      authAssumptions: [],
      sensitiveDataPaths: [],
      privilegedActions: [],
      securityInvariants: [],
      priorities: [],
      exclusions: [],
    }
  )
}

/**
 * A subagent that never calls `final_output` settles with plain text (a
 * harness message or the model's prose) instead of the structured result.
 * Keeping that text as the error explains the failure in the UI instead of
 * breaking the result file's schema.
 */
function scannerOutput(result: unknown): {
  readonly status: 'completed' | 'failed'
  readonly result?: ScannerOutcome['result']
  readonly error?: string
} {
  const parsed = scannerResultSchema.safeParse(result)
  if (parsed.success) return { status: 'completed', result: parsed.data }
  const text = typeof result === 'string' ? result.trim() : ''
  return {
    status: 'failed',
    error:
      text.length > 0
        ? `Scanner returned no structured output: ${text.slice(0, 2_000)}`
        : 'Scanner returned no structured output.',
  }
}

function asScannerResult(value: unknown) {
  const parsed = scannerResultSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

function aggregateInvestigations(
  outcomes: readonly ScannerOutcome[],
): InvestigationReport {
  const reports = outcomes
    .map((outcome) => asScannerResult(outcome.result)?.investigation)
    .filter((report): report is InvestigationReport => report !== undefined)
  return {
    strategy:
      reports.length > 0
        ? `Combined ${reports.length} independent, scanner-directed investigations.`
        : 'Only deterministic checks completed; no model-backed investigation report was produced.',
    focusAreas: reports.flatMap((report) => report.focusAreas),
    evidence: reports.flatMap((report) => report.evidence),
    blindSpots: [...new Set(reports.flatMap((report) => report.blindSpots))],
    confidence: reports.some((report) => report.confidence === 'low')
      ? 'low'
      : reports.some((report) => report.confidence === 'medium')
        ? 'medium'
        : reports.length > 0
          ? 'high'
          : 'low',
  }
}

function aggregateCoverage(
  outcomes: readonly ScannerOutcome[],
  investigation: InvestigationReport,
): ScanCoverage {
  const reports = outcomes
    .map((outcome) => asScannerResult(outcome.result)?.coverage)
    .filter((coverage): coverage is ScanCoverage => coverage !== undefined)
  const reviewed = dedupeByPath(
    reports.flatMap((coverage) => coverage.reviewed),
  )
  const fallbackReviewed = investigation.evidence.flatMap((evidence) => {
    if (evidence.kind === 'file') {
      return [
        {
          path: evidence.path,
          startLine: evidence.startLine,
          endLine: evidence.endLine,
          summary: evidence.summary,
        },
      ]
    }
    if (evidence.kind === 'repository-structure') {
      return evidence.paths.map((path) => ({ path, summary: evidence.summary }))
    }
    return []
  })
  return {
    completeness:
      reports.length === 0
        ? 'unknown'
        : reports.every((coverage) => coverage.completeness === 'complete')
          ? 'complete'
          : reports.some((coverage) => coverage.completeness === 'partial')
            ? 'partial'
            : 'unknown',
    reviewed: reviewed.length > 0 ? reviewed : dedupeByPath(fallbackReviewed),
    deferred: dedupePathReasons(
      reports.flatMap((coverage) => coverage.deferred),
    ),
    excluded: dedupePathReasons(
      reports.flatMap((coverage) => coverage.excluded),
    ),
    openQuestions: [
      ...new Set([
        ...reports.flatMap((coverage) => coverage.openQuestions),
        ...investigation.blindSpots,
      ]),
    ],
  }
}

function dedupeByPath<T extends { readonly path: string }>(
  entries: readonly T[],
): T[] {
  return [...new Map(entries.map((entry) => [entry.path, entry])).values()]
}

function dedupePathReasons<
  T extends { readonly path: string; readonly reason: string },
>(entries: readonly T[]): T[] {
  return [
    ...new Map(
      entries.map((entry) => [`${entry.path}\u0000${entry.reason}`, entry]),
    ).values(),
  ]
}
