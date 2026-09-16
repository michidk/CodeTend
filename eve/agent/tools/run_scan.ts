import { defineWorkflowTool } from 'eve/tools'
import { z } from 'zod'
import type {
  InvestigationReport,
  KnowledgeResult,
  ScanCheckpoint,
  ScanCoverage,
  ScannerOutcome,
  ScanRequest,
  ScanResult,
} from '../lib/contract'
import { UNAVAILABLE_DEPENDENCY_GRAPH } from '../lib/dependency-graph'
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
    const requestFingerprint = JSON.stringify({
      repositoryId: request.repositoryId,
      repositoryUrl: request.repositoryUrl,
      branch: request.branch,
      target: request.target,
      maxInputTokens: request.maxInputTokens,
      scanners: request.scanners.map((scanner) => scanner.id),
      dependencyAudit: request.dependencyAudit !== false,
      validation: request.validation,
    })
    const total =
      5 +
      request.scanners.length +
      (request.dependencyAudit === false ? 0 : 1) +
      (request.gitnexus ? 1 : 0)
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
    const scanners = request.scanners.map((scanner) => ({
      ...scanner,
      hypotheses: scanner.hypotheses.filter(
        (hypothesis) =>
          hypothesis.locations.length === 0 ||
          scanTarget.kind === 'repository' ||
          (scanTarget.kind === 'paths'
            ? hypothesis.locations.some((location) =>
                scanTarget.paths.some(
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

    let dependencyAudit: Awaited<ReturnType<typeof auditDependencies>> = {
      status: 'unavailable',
      error: 'The dependency scanner was disabled for this scan.',
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
    const staleness = assessKnowledgeStaleness(
      request.knowledge,
      workspace,
      request.knowledge?.fileCount ?? null,
    )
    let knowledgeBase: Omit<KnowledgeResult, 'dependencyGraph'>
    if (!staleness.refreshNeeded && request.knowledge) {
      knowledgeBase = {
        refreshed: false,
        overview: request.knowledge.overview,
        summary: request.knowledge.summary,
        sources: request.knowledge.sources,
        reason: staleness.reason,
      }
    } else {
      const output = (await ctx.agent('knowledge', {
        message: knowledgeAgentMessage({
          repoPath,
          repositoryName: request.repositoryName,
          workspace,
          previous: request.knowledge,
          staleness,
          gitnexusRepo,
          securityProfile: request.securityProfile,
        }),
        outputSchema: knowledgeOutputSchema,
      })) as unknown as KnowledgeAgentOutput | null
      knowledgeBase = output
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
            sources: resolveSources(output.sources, workspace),
            reason: staleness.reason,
          }
        : {
            refreshed: false,
            overview: request.knowledge?.overview ?? '',
            summary: request.knowledge?.summary ?? {
              languages: [],
              frameworks: [],
              subsystems: [],
              concepts: [],
            },
            sources: request.knowledge?.sources ?? [],
            reason: 'Knowledge agent returned no structured output.',
          }
    }
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
          (async (): Promise<{
            scannerId: string
            outcome: ScannerOutcome
          }> => {
            const startedAt = await nowIso()
            const message = scannerAgentMessage({
              scanner,
              siblingScanners: scanners,
              repoPath,
              repositoryName: request.repositoryName,
              workspace,
              knowledge,
              gitnexusRepo,
              previousCommitSha: request.previousCommitSha ?? null,
              target: request.target,
              maxInputTokens: Math.max(
                10_000,
                Math.floor(
                  request.maxInputTokens / Math.max(1, scanners.length),
                ),
              ),
              attentionHistory: scanner.attentionHistory,
              securityProfile,
            })
            try {
              let result: Awaited<ReturnType<typeof ctx.agent>> | null = null
              let lastError: unknown
              // Launching a dozen subagents at once occasionally trips a transient
              // start failure inside the runtime; one retry recovers it.
              for (let attempt = 0; attempt < SCANNER_ATTEMPTS; attempt += 1) {
                try {
                  result = await ctx.agent('scanner', {
                    message,
                    outputSchema: request.outputSchema as JsonObject,
                  })
                  lastError = undefined
                  break
                } catch (error) {
                  lastError = error
                }
              }
              if (lastError !== undefined) throw lastError
              return {
                scannerId: scanner.id,
                outcome: {
                  scannerId: scanner.id,
                  ...scannerOutput(result),
                  startedAt,
                  finishedAt: await nowIso(),
                },
              }
            } catch (error) {
              return {
                scannerId: scanner.id,
                outcome: {
                  scannerId: scanner.id,
                  status: 'failed',
                  error: describeError(error),
                  startedAt,
                  finishedAt: await nowIso(),
                },
              }
            }
          })(),
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
    const candidates = outcomes
      .filter((outcome) => outcome.scannerId === 'security')
      .flatMap((outcome) => {
        const result = asScannerResult(outcome.result)
        return (result?.findings ?? [])
          .filter((finding) => finding && typeof finding === 'object')
          .map((finding) => {
            const record = finding as Record<string, unknown>
            return {
              scannerId: outcome.scannerId,
              fingerprint: String(record.fingerprint ?? ''),
              validationPlan:
                record.validationPlan &&
                typeof record.validationPlan === 'object'
                  ? (record.validationPlan as {
                      method: string
                      commands: {
                        command: string
                        purpose: string
                        timeoutSeconds: number
                      }[]
                    })
                  : undefined,
            }
          })
          .filter((candidate) => candidate.fingerprint.length > 0)
      })

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

interface RawScannerResult {
  readonly summary?: string
  readonly findings?: readonly Record<string, unknown>[]
  readonly hypothesisVerdicts?: readonly Record<string, unknown>[]
  readonly investigation?: InvestigationReport
  readonly coverage?: ScanCoverage
}

/**
 * A subagent that never calls `final_output` settles with plain text (a
 * harness message or the model's prose) instead of the structured result.
 * Keeping that text as the error explains the failure in the UI instead of
 * breaking the result file's schema.
 */
function scannerOutput(
  result: unknown,
): Pick<ScannerOutcome, 'status' | 'result' | 'error'> {
  if (asScannerResult(result)) return { status: 'completed', result }
  const text = typeof result === 'string' ? result.trim() : ''
  return {
    status: 'failed',
    error:
      text.length > 0
        ? `Scanner returned no structured output: ${text.slice(0, 2_000)}`
        : 'Scanner returned no structured output.',
  }
}

function asScannerResult(value: unknown): RawScannerResult | null {
  return typeof value === 'object' && value !== null
    ? (value as RawScannerResult)
    : null
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
