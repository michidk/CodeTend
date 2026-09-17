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
import { getServerEnv } from '@/lib/env.server'
import {
  type PatchRequest,
  type PatchResult,
  patchRequestSchema,
  patchResultSchema,
  type ScanCheckpoint,
  type ScanRequest,
  type ScanResult,
  scanCheckpointSchema,
  scanRequestSchema,
  scanResultSchema,
} from '@/lib/eve-protocol'
import { scannerResultSchema } from '@/lib/findings'

/** The app and Eve exchange schema-validated JSON through the shared volume. */
export function dataDir(): string {
  return resolve(getServerEnv().TECDEBT_DATA_DIR)
}

export const workspacesDir = () => join(dataDir(), 'workspaces')
const requestsDir = () => join(dataDir(), 'requests')
const resultsDir = () => join(dataDir(), 'results')
export const gitnexusHome = () => join(dataDir(), 'gitnexus')

export type PatchRequestFile = PatchRequest

export async function writePatchRequest(
  request: PatchRequestFile,
): Promise<void> {
  await mkdir(requestsDir(), { recursive: true })
  await mkdir(resultsDir(), { recursive: true })
  await mkdir(workspacesDir(), { recursive: true })
  const target = join(requestsDir(), `patch-${request.patchId}.json`)
  await writeFile(
    `${target}.tmp`,
    JSON.stringify(patchRequestSchema.parse(request)),
  )
  await rename(`${target}.tmp`, target)
  await rm(join(resultsDir(), `patch-${request.patchId}.json`), { force: true })
}

export type ScanRequestFile = ScanRequest

export async function writeScanRequest(
  request: ScanRequestFile,
): Promise<void> {
  await mkdir(requestsDir(), { recursive: true })
  await mkdir(resultsDir(), { recursive: true })
  await mkdir(workspacesDir(), { recursive: true })
  const target = join(requestsDir(), `scan-${request.scanId}.json`)
  await writeFile(
    `${target}.tmp`,
    JSON.stringify(scanRequestSchema.parse(request)),
  )
  await rename(`${target}.tmp`, target)
  await rm(join(resultsDir(), `scan-${request.scanId}.json`), { force: true })
}

export type ScanResultFile = ScanResult
export type ScanCheckpointFile = ScanCheckpoint
export type PatchResultFile = PatchResult

export async function readPatchResult(
  patchId: number,
): Promise<PatchResultFile | null> {
  try {
    const raw = await readFile(
      join(resultsDir(), `patch-${patchId}.json`),
      'utf8',
    )
    return patchResultSchema.parse(JSON.parse(raw) as unknown)
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
  return scanResultSchema.parse(parsed)
}

export async function readScanCheckpoint(
  scanId: number,
): Promise<ScanCheckpointFile | null> {
  try {
    const raw = await readFile(
      join(resultsDir(), `scan-${scanId}.checkpoint.json`),
      'utf8',
    )
    return scanCheckpointSchema.parse(JSON.parse(raw) as unknown)
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
