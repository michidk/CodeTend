import '@tanstack/react-start/server-only'

import { existsSync } from 'node:fs'
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import { getServerEnv } from '@/lib/env.server'
import { scannerResultSchema } from '@/lib/findings'
import {
  type InvestigationReport,
  investigationReportSchema,
  type ScanTarget,
  type SecurityProfile,
} from '@/lib/security-scans'

/**
 * The app and the Eve runtime exchange scan requests and results through
 * JSON files under TECDEBT_DATA_DIR. This keeps large payloads out of the
 * model conversation; see eve/agent/lib/contract.ts for the same shapes.
 */
export function dataDir(): string {
  return resolve(getServerEnv().TECDEBT_DATA_DIR)
}

export const workspacesDir = () => join(dataDir(), 'workspaces')
const requestsDir = () => join(dataDir(), 'requests')
const resultsDir = () => join(dataDir(), 'results')
export const gitnexusHome = () => join(dataDir(), 'gitnexus')

export interface PatchRequestFile {
  readonly patchId: number
  readonly repositoryId: number
  readonly repositoryName: string
  readonly repositoryUrl: string
  readonly branch: string
  readonly revision: string
  readonly finding: {
    readonly id: number
    readonly title: string
    readonly severity: string
    readonly description: string
    readonly rootCause: string | null
    readonly whyItMatters: string
    readonly recommendation: string
    readonly locations: readonly unknown[]
    readonly codeEvidence: readonly unknown[] | null
    readonly validationPlan: {
      readonly method: string
      readonly commands: readonly {
        readonly command: string
        readonly purpose: string
        readonly timeoutSeconds: number
      }[]
    } | null
    readonly remediationTests: readonly string[] | null
    readonly preventiveControls: readonly string[] | null
  }
  readonly validation: {
    readonly enabled: boolean
    readonly runner: 'auto' | 'docker' | 'disabled'
    readonly image: string
  }
}

export async function writePatchRequest(
  request: PatchRequestFile,
): Promise<void> {
  await mkdir(requestsDir(), { recursive: true })
  await mkdir(resultsDir(), { recursive: true })
  await mkdir(workspacesDir(), { recursive: true })
  const target = join(requestsDir(), `patch-${request.patchId}.json`)
  await writeFile(`${target}.tmp`, JSON.stringify(request))
  await rename(`${target}.tmp`, target)
  await rm(join(resultsDir(), `patch-${request.patchId}.json`), { force: true })
}

export interface ScanRequestFile {
  readonly scanId: number
  readonly repositoryId: number
  readonly repositoryName: string
  readonly repositoryUrl: string
  readonly branch: string
  readonly gitnexus: boolean
  readonly knowledge: {
    readonly overview: string
    readonly summary: unknown
    readonly sources: readonly { path: string; hash: string }[]
    readonly fileCount: number | null
  } | null
  readonly previousCommitSha: string | null
  readonly target: ScanTarget
  readonly maxInputTokens: number
  readonly maxCostUsd: number | null
  readonly securityProfile: SecurityProfile | null
  readonly validation: {
    readonly enabled: boolean
    readonly runner: 'auto' | 'docker' | 'disabled'
    readonly image: string
  }
  readonly dependencyAudit: boolean
  readonly scanners: readonly {
    readonly id: string
    readonly name: string
    readonly prompt: string
    readonly hypotheses: readonly unknown[]
    readonly attentionHistory: readonly InvestigationReport[]
  }[]
  readonly outputSchema: unknown
}

export async function writeScanRequest(
  request: ScanRequestFile,
): Promise<void> {
  await mkdir(requestsDir(), { recursive: true })
  await mkdir(resultsDir(), { recursive: true })
  await mkdir(workspacesDir(), { recursive: true })
  const target = join(requestsDir(), `scan-${request.scanId}.json`)
  await writeFile(`${target}.tmp`, JSON.stringify(request))
  await rename(`${target}.tmp`, target)
  await rm(join(resultsDir(), `scan-${request.scanId}.json`), { force: true })
}

const knowledgeSummarySchema = z.object({
  languages: z.array(z.string()).default([]),
  frameworks: z.array(z.string()).default([]),
  subsystems: z
    .array(
      z.object({
        name: z.string(),
        paths: z.array(z.string()).default([]),
        responsibility: z.string().default(''),
      }),
    )
    .default([]),
  concepts: z.array(z.string()).default([]),
  securityProfile: z
    .object({
      projectOverview: z.string(),
      assets: z.array(z.string()),
      entryPoints: z.array(z.string()),
      trustBoundaries: z.array(z.string()),
      authAssumptions: z.array(z.string()),
      sensitiveDataPaths: z.array(z.string()),
      privilegedActions: z.array(z.string()),
      securityInvariants: z.array(z.string()),
      priorities: z.array(z.string()),
      exclusions: z.array(z.string()),
    })
    .optional(),
})

const subsystemDependencyGraphSchema = z
  .object({
    edges: z
      .array(
        z.object({
          source: z.string(),
          target: z.string(),
          weight: z.number(),
        }),
      )
      .default([]),
    cycles: z
      .array(
        z.object({
          files: z.array(z.string()).default([]),
          subsystems: z.array(z.string()).default([]),
        }),
      )
      .default([]),
    cycleStatus: z.enum(['clean', 'cycles_found', 'unavailable']),
    componentCount: z.number().nullable(),
  })
  .default({
    edges: [],
    cycles: [],
    cycleStatus: 'unavailable',
    componentCount: null,
  })

const scanResultFileSchema = z.object({
  scanId: z.number().int(),
  commitSha: z.string(),
  fileCount: z.number().int(),
  gitnexusUsed: z.boolean(),
  knowledge: z.object({
    refreshed: z.boolean(),
    overview: z.string(),
    summary: knowledgeSummarySchema,
    sources: z.array(z.object({ path: z.string(), hash: z.string() })),
    reason: z.string(),
    dependencyGraph: subsystemDependencyGraphSchema,
  }),
  securityProfile: z.object({
    profile: z.object({
      projectOverview: z.string(),
      assets: z.array(z.string()),
      entryPoints: z.array(z.string()),
      trustBoundaries: z.array(z.string()),
      authAssumptions: z.array(z.string()),
      sensitiveDataPaths: z.array(z.string()),
      privilegedActions: z.array(z.string()),
      securityInvariants: z.array(z.string()),
      priorities: z.array(z.string()),
      exclusions: z.array(z.string()),
    }),
    generated: z.boolean(),
  }),
  dependencyAudit: z
    .object({
      status: z.enum(['completed', 'unavailable', 'failed']),
      report: z.json().optional(),
      error: z.string().optional(),
      toolVersion: z.string().optional(),
    })
    .default({
      status: 'unavailable',
      error: 'This scan predates dependency auditing.',
    }),
  scanners: z.array(
    z.object({
      scannerId: z.string(),
      status: z.enum(['completed', 'failed']),
      result: scannerResultSchema.optional(),
      error: z.string().optional(),
      startedAt: z.string(),
      finishedAt: z.string(),
    }),
  ),
  investigation: investigationReportSchema,
  validations: z
    .array(
      z.object({
        scannerId: z.string(),
        fingerprint: z.string(),
        status: z.enum([
          'not_run',
          'confirmed',
          'not_reproduced',
          'inconclusive',
          'unavailable',
          'error',
        ]),
        method: z.string(),
        summary: z.string(),
        commands: z.array(
          z.object({
            command: z.string(),
            purpose: z.string(),
            timeoutSeconds: z.number(),
            exitCode: z.number().nullable(),
            stdout: z.string(),
            stderr: z.string(),
            timedOut: z.boolean(),
            durationMs: z.number(),
          }),
        ),
        proofGaps: z.array(z.string()),
        runner: z.string(),
        validatedAt: z.string(),
      }),
    )
    .default([]),
  finishedAt: z.string(),
})

export type ScanResultFile = z.infer<typeof scanResultFileSchema>

const scanCheckpointFileSchema = scanResultFileSchema
  .pick({
    scanId: true,
    commitSha: true,
    fileCount: true,
    gitnexusUsed: true,
    knowledge: true,
    securityProfile: true,
    dependencyAudit: true,
    scanners: true,
  })
  .extend({
    version: z.literal(1),
    requestFingerprint: z.string().min(1),
    updatedAt: z.string(),
  })

export type ScanCheckpointFile = z.infer<typeof scanCheckpointFileSchema>

const patchResultFileSchema = z.object({
  patchId: z.number().int().positive(),
  status: z.enum(['proposed', 'verified', 'failed']),
  summary: z.string(),
  diff: z.string(),
  changedFiles: z.array(z.string()),
  testRecommendations: z.array(z.string()),
  verification: z
    .object({
      scannerId: z.string(),
      fingerprint: z.string(),
      status: z.enum([
        'not_run',
        'confirmed',
        'not_reproduced',
        'inconclusive',
        'unavailable',
        'error',
      ]),
      method: z.string(),
      summary: z.string(),
      commands: z.array(
        z.object({
          command: z.string(),
          purpose: z.string(),
          timeoutSeconds: z.number(),
          exitCode: z.number().nullable(),
          stdout: z.string(),
          stderr: z.string(),
          timedOut: z.boolean(),
          durationMs: z.number(),
        }),
      ),
      proofGaps: z.array(z.string()),
      runner: z.string(),
      validatedAt: z.string(),
    })
    .nullable(),
  error: z.string().optional(),
  finishedAt: z.string(),
})

export type PatchResultFile = z.infer<typeof patchResultFileSchema>

export async function readPatchResult(
  patchId: number,
): Promise<PatchResultFile | null> {
  try {
    const raw = await readFile(
      join(resultsDir(), `patch-${patchId}.json`),
      'utf8',
    )
    return patchResultFileSchema.parse(JSON.parse(raw) as unknown)
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return null
    }
    throw error
  }
}

/**
 * Reads the result file Eve wrote. Individual scanner payloads that fail
 * schema validation are converted into failed scanner outcomes so one
 * malformed result never discards the others.
 */
export async function readScanResult(
  scanId: number,
): Promise<ScanResultFile | null> {
  let raw: string
  try {
    raw = await readFile(join(resultsDir(), `scan-${scanId}.json`), 'utf8')
  } catch {
    return null
  }
  const parsed: unknown = JSON.parse(raw)
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    Array.isArray((parsed as { scanners?: unknown }).scanners)
  ) {
    const record = parsed as { scanners: unknown[] }
    record.scanners = record.scanners.map((outcome) => {
      if (typeof outcome !== 'object' || outcome === null) return outcome
      const entry = outcome as {
        status?: string
        result?: unknown
        error?: string
      }
      if (entry.status !== 'completed') return outcome
      const check = scannerResultSchema.safeParse(entry.result)
      if (check.success) return { ...entry, result: check.data }
      return {
        ...entry,
        status: 'failed',
        result: undefined,
        error: `Scanner output did not match the finding schema: ${check.error.issues
          .slice(0, 3)
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ')}`,
      }
    })
  }
  return scanResultFileSchema.parse(parsed)
}

export async function readScanCheckpoint(
  scanId: number,
): Promise<ScanCheckpointFile | null> {
  try {
    const raw = await readFile(
      join(resultsDir(), `scan-${scanId}.checkpoint.json`),
      'utf8',
    )
    return scanCheckpointFileSchema.parse(JSON.parse(raw) as unknown)
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return null
    }
    throw error
  }
}

/** Resolves once Eve has written the result file, or rejects after `timeoutMs`. */
export async function waitForScanResult(
  scanId: number,
  timeoutMs: number,
  intervalMs = 5_000,
): Promise<void> {
  const target = join(resultsDir(), `scan-${scanId}.json`)
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(target)) return
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error(
    `Scan ${scanId} did not finish within ${Math.round(timeoutMs / 60_000)} minutes.`,
  )
}

export async function waitForPatchResult(
  patchId: number,
  timeoutMs: number,
  intervalMs = 3_000,
): Promise<void> {
  const target = join(resultsDir(), `patch-${patchId}.json`)
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(target)) return
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error(
    `Patch ${patchId} did not finish within ${Math.round(timeoutMs / 60_000)} minutes.`,
  )
}

export async function removePatchWorkspace(
  repositoryId: number,
  patchId: number,
): Promise<void> {
  await rm(join(workspacesDir(), `repo-${repositoryId}-patch-${patchId}`), {
    recursive: true,
    force: true,
  })
}

export async function removePatchArtifacts(patchId: number): Promise<void> {
  await Promise.all([
    rm(join(requestsDir(), `patch-${patchId}.json`), { force: true }),
    rm(join(requestsDir(), `patch-${patchId}.json.tmp`), { force: true }),
    rm(join(resultsDir(), `patch-${patchId}.json`), { force: true }),
    rm(join(resultsDir(), `patch-${patchId}.json.tmp`), { force: true }),
  ])
}

export async function removeScanWorkspace(
  repositoryId: number,
  scanId: number,
): Promise<void> {
  await rm(join(workspacesDir(), `repo-${repositoryId}-scan-${scanId}`), {
    recursive: true,
    force: true,
  })
}

/** Removes transient app↔Eve exchange files after their data is persisted. */
export async function removeScanArtifacts(scanId: number): Promise<void> {
  await Promise.all([
    rm(join(requestsDir(), `scan-${scanId}.json`), { force: true }),
    rm(join(requestsDir(), `scan-${scanId}.json.tmp`), { force: true }),
    rm(join(resultsDir(), `scan-${scanId}.json`), { force: true }),
    rm(join(resultsDir(), `scan-${scanId}.json.tmp`), { force: true }),
    rm(join(resultsDir(), `scan-${scanId}.checkpoint.json`), { force: true }),
    rm(join(resultsDir(), `scan-${scanId}.checkpoint.json.tmp`), {
      force: true,
    }),
  ])
}

/** Clears stale exchange files while preserving scans that can still recover. */
export async function pruneTransientScanArtifacts(
  protectedScanIds: ReadonlySet<number>,
): Promise<number> {
  let removed = 0
  for (const directory of [requestsDir(), resultsDir()]) {
    let entries: string[]
    try {
      entries = await readdir(directory)
    } catch {
      continue
    }
    for (const entry of entries) {
      const match = /^scan-(\d+)(?:\.checkpoint)?\.json(?:\.tmp)?$/.exec(entry)
      if (!match) continue
      const scanId = Number(match[1])
      if (protectedScanIds.has(scanId)) continue
      await rm(join(directory, entry), { force: true })
      removed += 1
    }
  }
  return removed
}

export async function pruneTransientPatchArtifacts(
  protectedPatchIds: ReadonlySet<number>,
): Promise<number> {
  let removed = 0
  for (const directory of [requestsDir(), resultsDir()]) {
    let entries: string[]
    try {
      entries = await readdir(directory)
    } catch {
      continue
    }
    for (const entry of entries) {
      const match = /^patch-(\d+)\.json(?:\.tmp)?$/.exec(entry)
      if (!match) continue
      const patchId = Number(match[1])
      if (protectedPatchIds.has(patchId)) continue
      await rm(join(directory, entry), { force: true })
      removed += 1
    }
  }
  return removed
}
