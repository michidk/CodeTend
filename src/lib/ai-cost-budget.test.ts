import { describe, expect, test } from 'bun:test'
import { hasReachedDailyAiCostBudget } from '@/lib/ai-cost-budget'

describe('daily AI cost budget', () => {
  test('is unlimited when no app limit is configured', () => {
    expect(
      hasReachedDailyAiCostBudget(null, {
        scanCostUsd: 500,
        patchCostUsd: 500,
      }),
    ).toBe(false)
  })

  test('combines scan and patch usage for the UTC-day limit', () => {
    expect(
      hasReachedDailyAiCostBudget(100, {
        scanCostUsd: 80,
        patchCostUsd: 20,
      }),
    ).toBe(true)
    expect(
      hasReachedDailyAiCostBudget(100, {
        scanCostUsd: 79,
        patchCostUsd: 20,
      }),
    ).toBe(false)
  })
})
