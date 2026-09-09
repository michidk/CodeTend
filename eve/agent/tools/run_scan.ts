import { defineWorkflowTool } from 'eve/tools'
import { z } from 'zod'
import type {
  KnowledgeResult,
  ScannerOutcome,
  ScanRequest,
  ScanResult,
} from '../lib/contract'
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
  cloneRepository,
  indexWithGitNexus,
  nowIso,
  readScanRequest,
  writeScanResult,
} from '../lib/steps'

interface Progress {
  readonly phase: string
  readonly detail?: string
  readonly scanId?: number
  readonly commitSha?: string
  readonly completed?: number
  readonly failed?: number
}

/**
 * The durable scan pipeline. Each `"use step"` function is checkpointed by
 * Eve; the subagent calls are durable too, so a crashed process resumes from
 * the last completed scanner instead of restarting the scan.
 */
export default defineWorkflowTool({
  description:
    'Run a full repository health scan for a scan id prepared by the tecdebt app. Clones the repository, refreshes repository knowledge, runs every specialized scanner and writes the result file.',
  inputSchema: z.object({ scanId: z.number().int().positive() }),
  label: {
    start: ({ scanId }) => `Scan #${scanId}`,
    delta: (_input, partial: Progress) => partial.phase,
  },
  async *execute({ scanId }, ctx) {
    'use workflow'

    const request: ScanRequest = await readScanRequest(scanId)

    const cloning: Progress = {
      phase: 'cloning',
      detail: `${request.repositoryUrl}#${request.branch}`,
    }
    yield cloning
    const workspace = await cloneRepository(request)
    const repoPath = sandboxRepoPath(workspace.name)

    let gitnexusRepo: string | null = null
    if (request.gitnexus) {
      const indexing: Progress = { phase: 'indexing', detail: 'GitNexus' }
      yield indexing
      const indexed = await indexWithGitNexus(workspace)
      if (indexed.ok) gitnexusRepo = workspace.name
    }

    const knowledgePhase: Progress = { phase: 'knowledge' }
    yield knowledgePhase
    const staleness = assessKnowledgeStaleness(
      request.knowledge,
      workspace,
      request.knowledge?.fileCount ?? null,
    )
    let knowledge: KnowledgeResult
    if (!staleness.refreshNeeded && request.knowledge) {
      knowledge = {
        refreshed: false,
        overview: request.knowledge.overview,
        summary: request.knowledge.summary,
        sources: request.knowledge.sources,
        reason: staleness.reason,
      }
    } else {
      const output = (await ctx.agent({
        key: 'knowledge',
        target: 'knowledge',
        message: knowledgeAgentMessage({
          repoPath,
          repositoryName: request.repositoryName,
          workspace,
          previous: request.knowledge,
          staleness,
          gitnexusRepo,
        }),
        outputSchema: knowledgeOutputSchema,
      })) as unknown as KnowledgeAgentOutput | null
      knowledge = output
        ? {
            refreshed: true,
            overview: output.overview,
            summary: {
              languages: output.languages,
              frameworks: output.frameworks,
              subsystems: output.subsystems,
              concepts: output.concepts,
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

    const scanning: Progress = { phase: 'scanning' }
    yield scanning

    // Every scanner is an independent subagent session; one failing scanner
    // never discards the others' results.
    const outcomes: ScannerOutcome[] = await Promise.all(
      request.scanners.map(async (scanner): Promise<ScannerOutcome> => {
        const startedAt = await nowIso()
        try {
          const result = await ctx.agent({
            key: `scanner:${scanner.id}`,
            target: 'scanner',
            message: scannerAgentMessage({
              scanner,
              repoPath,
              repositoryName: request.repositoryName,
              workspace,
              knowledge,
              gitnexusRepo,
            }),
            outputSchema: request.outputSchema as JsonObject,
          })
          return {
            scannerId: scanner.id,
            status: result ? 'completed' : 'failed',
            result: result ?? undefined,
            error: result
              ? undefined
              : 'Scanner returned no structured output.',
            startedAt,
            finishedAt: await nowIso(),
          }
        } catch (error) {
          return {
            scannerId: scanner.id,
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
            startedAt,
            finishedAt: await nowIso(),
          }
        }
      }),
    )

    const persisting: Progress = { phase: 'persisting' }
    yield persisting
    const result: ScanResult = {
      scanId,
      commitSha: workspace.commitSha,
      fileCount: workspace.fileCount,
      gitnexusUsed: gitnexusRepo !== null,
      knowledge,
      scanners: outcomes,
      finishedAt: await nowIso(),
    }
    await writeScanResult(result)

    const done: Progress = {
      phase: 'done',
      scanId,
      commitSha: workspace.commitSha,
      completed: outcomes.filter((outcome) => outcome.status === 'completed')
        .length,
      failed: outcomes.filter((outcome) => outcome.status === 'failed').length,
    }
    return done
  },
  toModelOutput(output: Progress) {
    return {
      type: 'text',
      value: `Scan ${output.scanId ?? '?'} finished at ${output.commitSha ?? '?'}: ${output.completed ?? 0} scanners completed, ${output.failed ?? 0} failed.`,
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
