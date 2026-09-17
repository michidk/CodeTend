import {
  patchRequestSchema,
  scanCheckpointSchema,
  scanRequestSchema,
} from '../../../src/lib/eve-protocol'
import type {
  PatchRequest,
  PatchResult,
  ScanCheckpoint,
  ScanRequest,
  ScanResult,
} from './contract'
import { requestsDir, resultsDir } from './paths'

export async function readScanRequest(scanId: number): Promise<ScanRequest> {
  'use step'
  const { readFile } = await import('node:fs/promises')
  const raw = await readFile(`${requestsDir()}/scan-${scanId}.json`, 'utf8')
  return scanRequestSchema.parse(JSON.parse(raw) as unknown)
}

export async function readPatchRequest(patchId: number): Promise<PatchRequest> {
  'use step'
  const { readFile } = await import('node:fs/promises')
  const raw = await readFile(`${requestsDir()}/patch-${patchId}.json`, 'utf8')
  return patchRequestSchema.parse(JSON.parse(raw) as unknown)
}

export async function writePatchResult(result: PatchResult): Promise<void> {
  'use step'
  const { mkdir, rename, writeFile } = await import('node:fs/promises')
  await mkdir(resultsDir(), { recursive: true })
  const target = `${resultsDir()}/patch-${result.patchId}.json`
  await writeFile(`${target}.tmp`, JSON.stringify(result))
  await rename(`${target}.tmp`, target)
}

/** Resolves repository-relative paths changed by a diff-scoped scan. */
export async function writeScanResult(result: ScanResult): Promise<void> {
  'use step'
  const { mkdir, rename, writeFile } = await import('node:fs/promises')
  await mkdir(resultsDir(), { recursive: true })
  const target = `${resultsDir()}/scan-${result.scanId}.json`
  await writeFile(`${target}.tmp`, JSON.stringify(result, null, 2))
  await rename(`${target}.tmp`, target)
}

export async function readScanCheckpoint(
  scanId: number,
): Promise<ScanCheckpoint | null> {
  'use step'
  const { readFile } = await import('node:fs/promises')
  try {
    return scanCheckpointSchema.parse(
      JSON.parse(
        await readFile(
          `${resultsDir()}/scan-${scanId}.checkpoint.json`,
          'utf8',
        ),
      ) as unknown,
    )
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

export async function writeScanCheckpoint(
  checkpoint: ScanCheckpoint,
): Promise<void> {
  'use step'
  const { mkdir, rename, writeFile } = await import('node:fs/promises')
  await mkdir(resultsDir(), { recursive: true })
  const target = `${resultsDir()}/scan-${checkpoint.scanId}.checkpoint.json`
  await writeFile(`${target}.tmp`, JSON.stringify(checkpoint, null, 2))
  await rename(`${target}.tmp`, target)
}

export async function nowIso(): Promise<string> {
  'use step'
  return new Date().toISOString()
}
