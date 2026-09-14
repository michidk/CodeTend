import { defineWorkflowTool } from 'eve/tools'
import { z } from 'zod'
import type { PatchResult, ScanRequest } from '../lib/contract'
import type { JsonObject } from '../lib/json'
import { sandboxRepoPath } from '../lib/paths'
import {
  applyGeneratedPatch,
  clonePatchRepository,
  nowIso,
  readPatchRequest,
  validateCandidates,
  writePatchResult,
} from '../lib/steps'

const fixerOutputSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'outcome',
    'summary',
    'diff',
    'changedFiles',
    'testRecommendations',
  ],
  properties: {
    outcome: {
      type: 'string',
      enum: ['patched', 'not_reproduced', 'needs_decision'],
      description:
        'patched when the diff fixes the finding; not_reproduced when the cited code no longer has the problem; needs_decision when the fix depends on a product decision the source does not settle.',
    },
    summary: { type: 'string', minLength: 3, maxLength: 4000 },
    diff: {
      type: 'string',
      maxLength: 500000,
      description: 'Unified diff for outcome patched; empty otherwise.',
    },
    changedFiles: {
      type: 'array',
      maxItems: 50,
      items: { type: 'string' },
    },
    testRecommendations: {
      type: 'array',
      maxItems: 20,
      items: { type: 'string' },
    },
  },
} satisfies JsonObject

export default defineWorkflowTool({
  description: 'Generate and validate one reviewable security patch.',
  inputSchema: z.object({ patchId: z.number().int().positive() }),
  async *execute({ patchId }, ctx) {
    'use workflow'
    yield { phase: 'reading finding' }
    const request = await readPatchRequest(patchId)
    yield { phase: 'cloning revision' }
    const workspace = await clonePatchRepository(request)
    const repoPath = sandboxRepoPath(workspace.name)

    try {
      yield { phase: 'generating patch' }
      const output = await ctx.agent('fixer', {
        outputSchema: fixerOutputSchema,
        message: patchMessage(request, repoPath),
      })
      if (!output || typeof output !== 'object') {
        throw new Error('Fixer returned no structured patch.')
      }
      const candidate = output as {
        outcome: 'patched' | 'not_reproduced' | 'needs_decision'
        summary: string
        diff: string
        changedFiles: string[]
        testRecommendations: string[]
      }
      if (candidate.outcome !== 'patched') {
        const result: PatchResult = {
          patchId,
          status: 'failed',
          summary: candidate.summary,
          diff: '',
          changedFiles: [],
          testRecommendations: candidate.testRecommendations,
          verification: null,
          error:
            candidate.outcome === 'not_reproduced'
              ? 'The fixer could not reproduce the finding in the current revision.'
              : 'The fix depends on a decision the fixer could not make from the source.',
          finishedAt: await nowIso(),
        }
        await writePatchResult(result)
        return `Patch ${patchId} not generated: ${candidate.outcome.replace('_', ' ')}.`
      }
      yield { phase: 'checking patch' }
      const applied = await applyGeneratedPatch({
        workspace,
        diff: candidate.diff,
      })

      let verification: PatchResult['verification'] = null
      if (request.finding.validationPlan) {
        yield { phase: 'verifying remediation' }
        const scanRequest = patchValidationRequest(request)
        const [result] = await validateCandidates({
          request: scanRequest,
          workspace,
          candidates: [
            {
              scannerId: 'security',
              fingerprint: `patch-${patchId}`,
              validationPlan: request.finding.validationPlan,
            },
          ],
        })
        verification = result ?? null
      }
      const verified = verification?.status === 'not_reproduced'
      const stillReproduces = verification?.status === 'confirmed'
      const result: PatchResult = {
        patchId,
        status: stillReproduces ? 'failed' : verified ? 'verified' : 'proposed',
        summary: candidate.summary,
        diff: applied.diff,
        changedFiles: applied.changedFiles,
        testRecommendations: candidate.testRecommendations,
        verification,
        finishedAt: await nowIso(),
      }
      await writePatchResult(result)
      return `Patch ${patchId} generated for review (${applied.changedFiles.length} files).`
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await writePatchResult({
        patchId,
        status: 'failed',
        summary: 'Patch generation failed.',
        diff: '',
        changedFiles: [],
        testRecommendations: [],
        verification: null,
        error: message,
        finishedAt: await nowIso(),
      })
      return `Patch ${patchId} failed: ${message}`
    }
  },
})

function patchMessage(
  request: Awaited<ReturnType<typeof readPatchRequest>>,
  repoPath: string,
): string {
  return [
    `Repository: ${request.repositoryName}`,
    `Checkout: ${repoPath}`,
    `Revision: ${request.revision}`,
    `Finding: ${request.finding.title} (${request.finding.severity})`,
    `Description: ${request.finding.description}`,
    `Root cause: ${request.finding.rootCause ?? 'not separately stated'}`,
    `Impact: ${request.finding.whyItMatters}`,
    `Recommended direction: ${request.finding.recommendation}`,
    `Locations: ${request.finding.locations.map((location) => `${location.path}:${location.startLine ?? 1}`).join(', ')}`,
    `Remediation tests: ${(request.finding.remediationTests ?? []).join('; ') || 'none stated'}`,
    `Preventive controls: ${(request.finding.preventiveControls ?? []).join('; ') || 'none stated'}`,
    '',
    'Inspect the checkout, decide the outcome, and return the structured result.',
  ].join('\n')
}

function patchValidationRequest(
  request: Awaited<ReturnType<typeof readPatchRequest>>,
): ScanRequest {
  return {
    scanId: -request.patchId,
    repositoryId: request.repositoryId,
    repositoryName: request.repositoryName,
    repositoryUrl: request.repositoryUrl,
    branch: request.branch,
    gitnexus: false,
    knowledge: null,
    previousCommitSha: null,
    target: { kind: 'repository' },
    maxCostUsd: null,
    maxFiles: 1,
    securityProfile: null,
    validation: request.validation,
    scanners: [],
    outputSchema: {},
  }
}
