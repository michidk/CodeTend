/** Provider-reported token counts for one or more model calls. */
export interface TokenUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
}

export const ZERO_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  }
}

export function totalTokens(usage: TokenUsage): number {
  return (
    usage.inputTokens +
    usage.outputTokens +
    usage.cacheReadTokens +
    usage.cacheWriteTokens
  )
}

interface ModelRates {
  /** USD per million uncached input tokens. */
  readonly input: number
  /** USD per million output tokens. */
  readonly output: number
  /** USD per million cache reads when the standard multiplier differs. */
  readonly cacheRead?: number
}

/**
 * Provider list prices (USD per million tokens, first-party APIs). Cache reads
 * default to 10% of the input price and cache writes to 125%. Models
 * with different cache read prices specify them explicitly. Unknown models still get their tokens tracked, but no cost is
 * estimated rather than a misleading one.
 *
 * Prices go stale: check this table against the OpenAI and Anthropic pricing
 * pages before each release (`git log -1 -- src/lib/ai-pricing.ts` shows when
 * it last moved). When adding a model, use the first-party list price even if
 * you run it through a gateway, and extend `ai-pricing.test.ts`.
 */
const MODEL_RATES: Readonly<Record<string, ModelRates>> = {
  'gpt-5.6-sol': { input: 4, output: 20 },
  'claude-fable-5': { input: 10, output: 50 },
  'claude-mythos-5': { input: 10, output: 50 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-opus-4-7': { input: 5, output: 25 },
  'claude-opus-4-6': { input: 5, output: 25 },
  'claude-opus-4-5': { input: 5, output: 25 },
  // https://platform.claude.com/docs/en/about-claude/pricing (2026-11-08)
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1 },
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-sonnet-4-5': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
}

const CACHE_READ_MULTIPLIER = 0.1
const CACHE_WRITE_MULTIPLIER = 1.25

/** Strips date suffixes and gateway prefixes: `anthropic/claude-opus-4-5-20251101` → `claude-opus-4-5`. */
export function normalizeModelId(modelId: string): string {
  const bare = modelId.slice(modelId.lastIndexOf('/') + 1).toLowerCase()
  return bare.replace(/-\d{8}$/, '')
}

export function isPricedModel(modelId: string): boolean {
  return normalizeModelId(modelId) in MODEL_RATES
}

/**
 * Estimated cost in USD, or null when the model has no known rate. A
 * provider-reported cost, when present, always wins over the local table.
 */
export function estimateCostUsd(
  modelId: string | null,
  usage: TokenUsage,
  reportedCostUsd?: number | null,
): number | null {
  if (reportedCostUsd != null && Number.isFinite(reportedCostUsd)) {
    return Math.max(0, reportedCostUsd)
  }
  const rates = modelId ? MODEL_RATES[normalizeModelId(modelId)] : undefined
  if (!rates) return null
  return (
    (usage.inputTokens * rates.input +
      usage.cacheReadTokens *
        (rates.cacheRead ?? rates.input * CACHE_READ_MULTIPLIER) +
      usage.cacheWriteTokens * rates.input * CACHE_WRITE_MULTIPLIER +
      usage.outputTokens * rates.output) /
    1_000_000
  )
}
