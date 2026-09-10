import { describe, expect, test } from 'bun:test'
import {
  addUsage,
  estimateCostUsd,
  isPricedModel,
  normalizeModelId,
  totalTokens,
  ZERO_USAGE,
} from '@/lib/ai-pricing'

describe('AI pricing', () => {
  test('normalizes provider prefixes and dated Anthropic model ids', () => {
    expect(normalizeModelId('anthropic/claude-sonnet-4-5-20250929')).toBe(
      'claude-sonnet-4-5',
    )
    expect(isPricedModel('claude-sonnet-4-5-20250929')).toBe(true)
    expect(isPricedModel('custom-model')).toBe(false)
  })

  test('prices input, output and cache token classes', () => {
    const cost = estimateCostUsd('gpt-5.6-sol', {
      inputTokens: 1_000,
      outputTokens: 200,
      cacheReadTokens: 500,
      cacheWriteTokens: 100,
    })

    expect(cost).toBeCloseTo(0.0087, 10)
  })

  test('prefers a provider cost and leaves unknown models unpriced', () => {
    expect(estimateCostUsd('custom-model', ZERO_USAGE)).toBeNull()
    expect(estimateCostUsd('custom-model', ZERO_USAGE, 0.42)).toBe(0.42)
    expect(estimateCostUsd('custom-model', ZERO_USAGE, -1)).toBe(0)
  })

  test('adds and totals usage', () => {
    const usage = addUsage(
      {
        inputTokens: 10,
        outputTokens: 2,
        cacheReadTokens: 3,
        cacheWriteTokens: 1,
      },
      {
        inputTokens: 20,
        outputTokens: 4,
        cacheReadTokens: 6,
        cacheWriteTokens: 2,
      },
    )

    expect(usage).toEqual({
      inputTokens: 30,
      outputTokens: 6,
      cacheReadTokens: 9,
      cacheWriteTokens: 3,
    })
    expect(totalTokens(usage)).toBe(48)
  })
})
