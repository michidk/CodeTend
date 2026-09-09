import { describe, expect, test } from 'bun:test'
import {
  aggregateScanUsage,
  usageColumns,
} from '@/lib/server/scan-usage.server'

function record(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    eventId: 'event-1',
    sessionId: 'root-session',
    turnId: 'root-turn',
    stepIndex: 0,
    agent: 'root',
    scannerId: null,
    modelId: 'claude-sonnet-5',
    inputTokens: 100,
    outputTokens: 10,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: null,
    ...overrides,
  })
}

describe('scan usage aggregation', () => {
  test('groups scanner calls and ignores malformed or replayed steps', () => {
    const raw = [
      record(),
      record({
        eventId: 'event-2',
        sessionId: 'scanner-session',
        turnId: 'scanner-turn',
        agent: 'scanner',
        scannerId: 'security',
        inputTokens: 200,
        outputTokens: 20,
        cacheReadTokens: 50,
      }),
      record({
        eventId: 'replayed-event',
        sessionId: 'scanner-session',
        turnId: 'scanner-turn',
        agent: 'scanner',
        scannerId: 'security',
        inputTokens: 999_999,
      }),
      record({
        eventId: 'event-3',
        sessionId: 'scanner-session',
        turnId: 'scanner-turn',
        stepIndex: 1,
        agent: 'scanner',
        scannerId: 'security',
        modelId: 'custom-model',
        inputTokens: 10,
        outputTokens: 1,
      }),
      record({
        eventId: 'event-4',
        sessionId: 'knowledge-session',
        turnId: 'knowledge-turn',
        agent: 'knowledge',
        inputTokens: 50,
        outputTokens: 5,
      }),
      '{not json}',
    ].join('\n')

    const usage = aggregateScanUsage('root-session', raw)

    expect(usage).not.toBeNull()
    expect(usage?.model).toBe('claude-sonnet-5')
    expect(usage?.total).toMatchObject({
      inputTokens: 360,
      outputTokens: 36,
      cacheReadTokens: 50,
      cacheWriteTokens: 0,
      modelCalls: 4,
      estimatedCostUsd: null,
    })
    expect(usage?.perScanner.get('security')).toMatchObject({
      inputTokens: 210,
      outputTokens: 21,
      cacheReadTokens: 50,
      cacheWriteTokens: 0,
      modelCalls: 2,
      estimatedCostUsd: null,
    })
  })

  test('returns no usage when a file has no valid records', () => {
    expect(aggregateScanUsage('root-session', '')).toBeNull()
    expect(aggregateScanUsage('root-session', '{"inputTokens": 1}')).toBeNull()
  })

  test('maps totals to nullable database columns', () => {
    const usage = aggregateScanUsage('root-session', record())

    expect(usageColumns(undefined)).toEqual({})
    expect(usageColumns(usage?.total)).toMatchObject({
      inputTokens: 100,
      outputTokens: 10,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      modelCalls: 1,
    })
    expect(usageColumns(usage?.total).estimatedCostUsd).toBeCloseTo(0.00045, 10)
  })
})
