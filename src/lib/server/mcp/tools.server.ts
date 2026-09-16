import '@tanstack/react-start/server-only'

import { McpServer } from '@modelcontextprotocol/server'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db'
import {
  findingEvents,
  findingOccurrences,
  findingPatches,
  findings,
  findingValidations,
  repositories,
  scans,
} from '@/db/schema'
import { OPEN_FINDING_STATES } from '@/lib/findings'
import { buildFixPrompt } from '@/lib/fix-prompt'
import {
  MCP_TOOL_CATALOG,
  MCP_TOOL_NAMES,
  type McpScope,
  type McpToolName,
} from '@/lib/mcp/catalog'
import {
  updateFindingAsFixed,
  updateFindingDisposition,
} from '@/lib/server/finding-triage'
import {
  requestScanCancellation,
  startScan,
} from '@/lib/server/scan-pipeline.server'
import { listGlobalScanners } from '@/lib/server/scanner-settings'
import { ensureScheduler } from '@/lib/server/scheduler.server'

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const

const writeAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const

const jsonObject = z.looseObject({})
const repositoryListOutput = z.object({
  repositories: z.array(jsonObject),
  total: z.number().int(),
  offset: z.number().int(),
  limit: z.number().int(),
  hasMore: z.boolean(),
})
const repositoryOutput = z.object({ repository: jsonObject.nullable() })
const scanListOutput = z.object({
  scans: z.array(jsonObject),
  total: z.number().int(),
  offset: z.number().int(),
  limit: z.number().int(),
  hasMore: z.boolean(),
})
const scanOutput = z.object({ scan: jsonObject.nullable() })
const findingOutput = z.object({ finding: jsonObject.nullable() })
const scanMutationOutput = z.object({ scanId: z.number().int().positive() })
const findingMutationOutput = z.object({ finding: jsonObject })
const fixPromptOutput = z.object({
  repositoryId: z.number().int().positive(),
  scannerId: z.string(),
  findingCount: z.number().int().min(0),
  prompt: z.string(),
})

type ListInput = { offset: number; limit: number }
type ScanListInput = ListInput & {
  repositoryId?: number
  status?: (typeof SCAN_STATUS_VALUES)[number]
}

const SCAN_STATUS_VALUES = [
  'queued',
  'running',
  'completed',
  'partial',
  'failed',
  'cancelled',
] as const

export type McpLoaders = {
  listRepositories(input: ListInput): Promise<unknown>
  getRepository(repositoryId: number): Promise<unknown>
  listScans(input: ScanListInput): Promise<unknown>
  getScan(scanId: number): Promise<unknown>
  getFinding(findingId: number): Promise<unknown>
  generateFixPrompt(repositoryId: number, scannerId: string): Promise<unknown>
  triggerScan(repositoryId: number): Promise<unknown>
  cancelScan(scanId: number): Promise<unknown>
  markFindingFixed(findingId: number, note: string): Promise<unknown>
  markFindingFalsePositive(findingId: number, note: string): Promise<unknown>
  acceptFindingRisk(findingId: number, note: string): Promise<unknown>
  reopenFinding(findingId: number): Promise<unknown>
}

const defaultLoaders: McpLoaders = {
  async listRepositories({ offset, limit }) {
    ensureScheduler()
    const rows = await db.query.repositories.findMany({
      orderBy: [desc(repositories.createdAt)],
      offset,
      limit: limit + 1,
      with: {
        scans: {
          orderBy: [desc(scans.createdAt)],
          limit: 1,
          columns: {
            id: true,
            status: true,
            overallScore: true,
            grade: true,
            createdAt: true,
            finishedAt: true,
          },
        },
      },
    })
    const total = await db.$count(repositories)
    return {
      repositories: rows
        .slice(0, limit)
        .map(({ scans: recent, ...repository }) => ({
          ...repository,
          latestScan: recent[0] ?? null,
        })),
      total,
      offset,
      limit,
      hasMore: rows.length > limit,
    }
  },

  async getRepository(repositoryId) {
    ensureScheduler()
    const repository = await db.query.repositories.findFirst({
      where: eq(repositories.id, repositoryId),
      with: {
        scans: {
          orderBy: [desc(scans.createdAt)],
          limit: 20,
          columns: { manifest: false },
        },
        findings: {
          orderBy: [desc(findings.updatedAt)],
          limit: 100,
        },
        knowledge: {
          columns: {
            overview: true,
            summary: true,
            commitSha: true,
            fileCount: true,
            refreshedAt: true,
          },
        },
      },
    })
    return { repository: repository ?? null }
  },

  async listScans({ repositoryId, status, offset, limit }) {
    ensureScheduler()
    const filters = [
      repositoryId ? eq(scans.repositoryId, repositoryId) : undefined,
      status ? eq(scans.status, status) : undefined,
    ].filter((filter) => filter !== undefined)
    const where = filters.length > 0 ? and(...filters) : undefined
    const rows = await db.query.scans.findMany({
      where,
      orderBy: [desc(scans.createdAt)],
      offset,
      limit: limit + 1,
      columns: { manifest: false },
      with: { repository: { columns: { id: true, name: true } } },
    })
    const total = await db.$count(scans, where)
    return {
      scans: rows.slice(0, limit),
      total,
      offset,
      limit,
      hasMore: rows.length > limit,
    }
  },

  async getScan(scanId) {
    const scan = await db.query.scans.findFirst({
      where: eq(scans.id, scanId),
      columns: { manifest: false },
      with: {
        repository: { columns: { id: true, name: true } },
        scannerRuns: { columns: { fixPrompt: false, eveSessionId: false } },
        artifacts: { columns: { kind: true, contentType: true, sha256: true } },
      },
    })
    if (!scan) return { scan: null }
    const occurrences = await db.query.findingOccurrences.findMany({
      where: eq(findingOccurrences.scanId, scanId),
      orderBy: [desc(findingOccurrences.createdAt)],
      limit: 200,
      with: { finding: true },
    })
    return { scan: { ...scan, occurrences } }
  },

  async getFinding(findingId) {
    const finding = await db.query.findings.findFirst({
      where: eq(findings.id, findingId),
      with: {
        repository: { columns: { id: true, name: true } },
        occurrences: {
          orderBy: [desc(findingOccurrences.createdAt)],
          limit: 20,
        },
        validations: {
          orderBy: [desc(findingValidations.createdAt)],
          limit: 10,
        },
        patches: { orderBy: [desc(findingPatches.createdAt)], limit: 5 },
        events: { orderBy: [desc(findingEvents.createdAt)], limit: 20 },
      },
    })
    return { finding: finding ?? null }
  },

  async generateFixPrompt(repositoryId, scannerId) {
    const [repository, scannerDefinitions, latestScan, openFindings] =
      await Promise.all([
        db.query.repositories.findFirst({
          where: eq(repositories.id, repositoryId),
        }),
        listGlobalScanners(),
        db.query.scans.findFirst({
          where: and(
            eq(scans.repositoryId, repositoryId),
            inArray(scans.status, ['completed', 'partial']),
          ),
          orderBy: [desc(scans.createdAt)],
          columns: { commitSha: true },
        }),
        db.query.findings.findMany({
          where: and(
            eq(findings.repositoryId, repositoryId),
            eq(findings.scannerId, scannerId),
            inArray(findings.state, [...OPEN_FINDING_STATES]),
          ),
        }),
      ])
    if (!repository) throw new Error('Repository not found')
    const scanner = scannerDefinitions.find(
      (candidate) => candidate.id === scannerId,
    )
    if (!scanner) throw new Error('Scanner not found')
    return {
      repositoryId,
      scannerId,
      findingCount: openFindings.length,
      prompt: buildFixPrompt({
        scanner,
        repositoryName: repository.name,
        repositoryUrl: repository.url,
        branch: repository.branch,
        commitSha: latestScan?.commitSha ?? null,
        findings: openFindings.map((finding) => ({
          ...finding,
          classification: finding.classification ?? undefined,
          vulnerability: finding.vulnerability ?? undefined,
          priority: finding.priority ?? undefined,
          priorityScore: finding.priorityScore ?? undefined,
        })),
      }),
    }
  },

  async triggerScan(repositoryId) {
    ensureScheduler()
    const repository = await db.query.repositories.findFirst({
      where: eq(repositories.id, repositoryId),
      columns: { id: true },
    })
    if (!repository) throw new Error('Repository not found')
    const scanId = await startScan(repositoryId, 'manual')
    if (scanId === null)
      throw new Error('A scan is already running for this repository')
    return { scanId }
  },

  async cancelScan(scanId) {
    const scan = await db.query.scans.findFirst({
      where: and(
        eq(scans.id, scanId),
        inArray(scans.status, ['queued', 'running']),
      ),
      columns: { id: true },
    })
    if (!scan) throw new Error('Queued or running scan not found')
    await requestScanCancellation(scanId)
    return { scanId }
  },

  async markFindingFalsePositive(findingId, note) {
    const finding = await updateFindingDisposition({
      findingId,
      disposition: 'false_positive',
      note,
    })
    return { finding }
  },

  async markFindingFixed(findingId, note) {
    const finding = await updateFindingAsFixed({ findingId, note })
    return { finding }
  },

  async acceptFindingRisk(findingId, note) {
    const finding = await updateFindingDisposition({
      findingId,
      disposition: 'accepted_risk',
      note,
    })
    return { finding }
  },

  async reopenFinding(findingId) {
    const finding = await updateFindingDisposition({
      findingId,
      disposition: null,
      note: '',
    })
    return { finding }
  },
}

function jsonToolResult(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
    structuredContent: value,
  }
}

function errorToolResult(error: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text:
          error instanceof Error ? error.message : 'The MCP operation failed',
      },
    ],
    isError: true,
  }
}

async function result(schema: z.ZodType, operation: () => Promise<unknown>) {
  try {
    const serialized = JSON.parse(JSON.stringify(await operation()))
    return jsonToolResult(schema.parse(serialized))
  } catch (error) {
    return errorToolResult(error)
  }
}

export type McpToolAccess = {
  scopes?: readonly McpScope[]
  enabledTools?: readonly McpToolName[]
}

export function createCodeTendMcpServer(
  loaders: McpLoaders = defaultLoaders,
  access: McpToolAccess = {},
) {
  const scopes = new Set<McpScope>(access.scopes ?? ['codetend:read'])
  const enabledTools = new Set<McpToolName>(
    access.enabledTools ?? MCP_TOOL_NAMES,
  )
  const allowed = (name: McpToolName) => {
    const tool = MCP_TOOL_CATALOG.find((candidate) => candidate.name === name)
    return Boolean(tool && enabledTools.has(name) && scopes.has(tool.scope))
  }
  const server = new McpServer(
    { name: 'codetend', version: '1.0.0' },
    {
      instructions:
        'Scoped access to CodeTend repository health. Read tools are bounded and return current persisted scan data. Use list tools before detail tools when an ID is unknown. Starting a scan can consume configured AI budget; only call trigger_scan when the user explicitly asks. Never present a scanner finding as proven beyond its recorded confidence and evidence.',
    },
  )

  if (allowed('list_repositories'))
    server.registerTool(
      'list_repositories',
      {
        title: 'List repositories',
        description:
          'List tracked repositories newest first, with their latest scan.',
        inputSchema: z.object({
          offset: z.int().min(0).default(0),
          limit: z.int().min(1).max(100).default(25),
        }),
        outputSchema: repositoryListOutput,
        annotations: readOnlyAnnotations,
      },
      (input) =>
        result(repositoryListOutput, () => loaders.listRepositories(input)),
    )

  if (allowed('get_repository'))
    server.registerTool(
      'get_repository',
      {
        title: 'Get repository health',
        description:
          'Get one repository with up to 20 recent scans, 100 recent findings, and its knowledge overview.',
        inputSchema: z.object({ repositoryId: z.int().positive() }),
        outputSchema: repositoryOutput,
        annotations: readOnlyAnnotations,
      },
      ({ repositoryId }) =>
        result(repositoryOutput, () => loaders.getRepository(repositoryId)),
    )

  if (allowed('list_scans'))
    server.registerTool(
      'list_scans',
      {
        title: 'List scans',
        description:
          'List recent scans, optionally filtered by repository and status.',
        inputSchema: z.object({
          repositoryId: z.int().positive().optional(),
          status: z.enum(SCAN_STATUS_VALUES).optional(),
          offset: z.int().min(0).default(0),
          limit: z.int().min(1).max(100).default(25),
        }),
        outputSchema: scanListOutput,
        annotations: readOnlyAnnotations,
      },
      (input) => result(scanListOutput, () => loaders.listScans(input)),
    )

  if (allowed('get_scan'))
    server.registerTool(
      'get_scan',
      {
        title: 'Get scan details',
        description:
          'Get one scan with scanner runs and up to 200 occurrences.',
        inputSchema: z.object({ scanId: z.int().positive() }),
        outputSchema: scanOutput,
        annotations: readOnlyAnnotations,
      },
      ({ scanId }) => result(scanOutput, () => loaders.getScan(scanId)),
    )

  if (allowed('get_finding'))
    server.registerTool(
      'get_finding',
      {
        title: 'Get finding details',
        description:
          'Get a finding with its evidence and bounded occurrence, validation, patch, and event history.',
        inputSchema: z.object({ findingId: z.int().positive() }),
        outputSchema: findingOutput,
        annotations: readOnlyAnnotations,
      },
      ({ findingId }) =>
        result(findingOutput, () => loaders.getFinding(findingId)),
    )

  if (allowed('generate_fix_prompt'))
    server.registerTool(
      'generate_fix_prompt',
      {
        title: 'Generate fix prompt',
        description:
          'Generate a coding-agent prompt from the current open findings for one repository scanner.',
        inputSchema: z.object({
          repositoryId: z.int().positive(),
          scannerId: z.string().trim().min(1).max(60),
        }),
        outputSchema: fixPromptOutput,
        annotations: readOnlyAnnotations,
      },
      ({ repositoryId, scannerId }) =>
        result(fixPromptOutput, () =>
          loaders.generateFixPrompt(repositoryId, scannerId),
        ),
    )

  if (allowed('trigger_scan'))
    server.registerTool(
      'trigger_scan',
      {
        title: 'Trigger scan',
        description:
          'Queue a default manual scan. This can consume the instance AI budget.',
        inputSchema: z.object({ repositoryId: z.int().positive() }),
        outputSchema: scanMutationOutput,
        annotations: writeAnnotations,
      },
      ({ repositoryId }) =>
        result(scanMutationOutput, () => loaders.triggerScan(repositoryId)),
    )

  if (allowed('cancel_scan'))
    server.registerTool(
      'cancel_scan',
      {
        title: 'Cancel scan',
        description: 'Request cancellation of a queued or running scan.',
        inputSchema: z.object({ scanId: z.int().positive() }),
        outputSchema: scanMutationOutput,
        annotations: { ...writeAnnotations, idempotentHint: true },
      },
      ({ scanId }) =>
        result(scanMutationOutput, () => loaders.cancelScan(scanId)),
    )

  if (allowed('mark_finding_false_positive'))
    server.registerTool(
      'mark_finding_false_positive',
      {
        title: 'Mark finding false positive',
        description:
          'Resolve a finding as a false positive and record optional operator context.',
        inputSchema: z.object({
          findingId: z.int().positive(),
          note: z.string().trim().max(2_000).default(''),
        }),
        outputSchema: findingMutationOutput,
        annotations: writeAnnotations,
      },
      ({ findingId, note }) =>
        result(findingMutationOutput, () =>
          loaders.markFindingFalsePositive(findingId, note),
        ),
    )

  if (allowed('mark_finding_fixed'))
    server.registerTool(
      'mark_finding_fixed',
      {
        title: 'Mark finding fixed',
        description:
          'Resolve a finding as fixed based on an operator-reported code or configuration change. A later scan can regress it if rediscovered.',
        inputSchema: z.object({
          findingId: z.int().positive(),
          note: z.string().trim().min(5).max(2_000),
        }),
        outputSchema: findingMutationOutput,
        annotations: writeAnnotations,
      },
      ({ findingId, note }) =>
        result(findingMutationOutput, () =>
          loaders.markFindingFixed(findingId, note),
        ),
    )

  if (allowed('accept_finding_risk'))
    server.registerTool(
      'accept_finding_risk',
      {
        title: 'Accept finding risk',
        description:
          'Resolve a finding as an accepted risk and record why it is acceptable.',
        inputSchema: z.object({
          findingId: z.int().positive(),
          note: z.string().trim().min(5).max(2_000),
        }),
        outputSchema: findingMutationOutput,
        annotations: writeAnnotations,
      },
      ({ findingId, note }) =>
        result(findingMutationOutput, () =>
          loaders.acceptFindingRisk(findingId, note),
        ),
    )

  if (allowed('reopen_finding'))
    server.registerTool(
      'reopen_finding',
      {
        title: 'Reopen finding',
        description:
          'Remove a false-positive or accepted-risk disposition and return the finding to active.',
        inputSchema: z.object({ findingId: z.int().positive() }),
        outputSchema: findingMutationOutput,
        annotations: writeAnnotations,
      },
      ({ findingId }) =>
        result(findingMutationOutput, () => loaders.reopenFinding(findingId)),
    )

  return server
}
