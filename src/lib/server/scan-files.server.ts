import '@tanstack/react-start/server-only'

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import { getServerEnv } from '@/lib/env.server'
import { scannerResultSchema } from '@/lib/findings'

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
  readonly scanners: readonly {
    readonly id: string
    readonly name: string
    readonly prompt: string
    readonly hypotheses: readonly unknown[]
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
  finishedAt: z.string(),
})

export type ScanResultFile = z.infer<typeof scanResultFileSchema>

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

export async function removeScanWorkspace(
  repositoryId: number,
  scanId: number,
): Promise<void> {
  await rm(join(workspacesDir(), `repo-${repositoryId}-scan-${scanId}`), {
    recursive: true,
    force: true,
  })
}
