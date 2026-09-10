import '@tanstack/react-start/server-only'

import { readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import {
  addUsage,
  estimateCostUsd,
  type TokenUsage,
  ZERO_USAGE,
} from '@/lib/ai-pricing'
import { dataDir } from '@/lib/server/scan-files.server'

/**
 * The Eve hooks append one JSON line per model step to
 * `usage/<rootSessionId>.jsonl` (see eve/agent/lib/usage.ts). After a scan
 * finishes, the app folds that file into totals for the scan and for every
 * scanner and deletes it.
 */
const usageRecordSchema = z.object({
  eventId: z.string().optional(),
  sessionId: z.string(),
  turnId: z.string(),
  stepIndex: z.number().int().nonnegative(),
  agent: z.string(),
  scannerId: z.string().nullable(),
  modelId: z.string().nullable(),
  inputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(),
  cacheReadTokens: z.number().nonnegative(),
  cacheWriteTokens: z.number().nonnegative(),
  costUsd: z.number().nullable().optional(),
})

export interface UsageTotals extends TokenUsage {
  readonly modelCalls: number
  /** Null when at least one step used a model with no known price. */
  readonly estimatedCostUsd: number | null
}

export interface ScanUsage {
  readonly rootSessionId: string
  readonly model: string | null
  readonly total: UsageTotals
  readonly perScanner: ReadonlyMap<string, UsageTotals>
}

const usageDir = () => join(dataDir(), 'usage')

export async function readScanUsage(
  rootSessionId: string,
): Promise<ScanUsage | null> {
  let raw: string
  try {
    raw = await readFile(join(usageDir(), `${rootSessionId}.jsonl`), 'utf8')
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

  return aggregateScanUsage(rootSessionId, raw)
}

/** Folds the append-only hook output and ignores malformed or replayed rows. */
export function aggregateScanUsage(
  rootSessionId: string,
  raw: string,
): ScanUsage | null {
  let total = emptyTotals()
  const perScanner = new Map<string, UsageTotals>()
  const models = new Map<string, number>()
  const seenSteps = new Set<string>()
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    const check = usageRecordSchema.safeParse(parsed)
    if (!check.success) continue
    const record = check.data
    const stepKey = `${record.sessionId}\u0000${record.turnId}\u0000${record.stepIndex}`
    if (seenSteps.has(stepKey)) continue
    seenSteps.add(stepKey)
    const step = stepTotals(record)
    total = addTotals(total, step)
    if (record.modelId) {
      models.set(record.modelId, (models.get(record.modelId) ?? 0) + 1)
    }
    if (record.agent === 'scanner' && record.scannerId) {
      perScanner.set(
        record.scannerId,
        addTotals(perScanner.get(record.scannerId) ?? emptyTotals(), step),
      )
    }
  }

  if (seenSteps.size === 0) return null

  const model =
    [...models.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  return { rootSessionId, model, total, perScanner }
}

export async function removeScanUsage(rootSessionId: string): Promise<void> {
  await rm(join(usageDir(), `${rootSessionId}.jsonl`), { force: true })
}

export async function pruneTransientUsageFiles(
  protectedSessionIds: ReadonlySet<string>,
): Promise<number> {
  let entries: string[]
  try {
    entries = await readdir(usageDir())
  } catch {
    return 0
  }
  let removed = 0
  for (const entry of entries) {
    if (!entry.endsWith('.jsonl')) continue
    const sessionId = entry.slice(0, -'.jsonl'.length)
    if (protectedSessionIds.has(sessionId)) continue
    await rm(join(usageDir(), entry), { force: true })
    removed += 1
  }
  return removed
}

function emptyTotals(): UsageTotals {
  return { ...ZERO_USAGE, modelCalls: 0, estimatedCostUsd: 0 }
}

function stepTotals(record: z.infer<typeof usageRecordSchema>): UsageTotals {
  const usage: TokenUsage = {
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    cacheReadTokens: record.cacheReadTokens,
    cacheWriteTokens: record.cacheWriteTokens,
  }
  return {
    ...usage,
    modelCalls: 1,
    estimatedCostUsd: estimateCostUsd(record.modelId, usage, record.costUsd),
  }
}

function addTotals(a: UsageTotals, b: UsageTotals): UsageTotals {
  return {
    ...addUsage(a, b),
    modelCalls: a.modelCalls + b.modelCalls,
    estimatedCostUsd:
      a.estimatedCostUsd === null || b.estimatedCostUsd === null
        ? null
        : a.estimatedCostUsd + b.estimatedCostUsd,
  }
}

/** Column values for `scans` / `scanner_runs` from one totals object. */
export function usageColumns(totals: UsageTotals | undefined) {
  if (!totals) return {}
  return {
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    cacheReadTokens: totals.cacheReadTokens,
    cacheWriteTokens: totals.cacheWriteTokens,
    estimatedCostUsd: totals.estimatedCostUsd,
    modelCalls: totals.modelCalls,
  }
}
