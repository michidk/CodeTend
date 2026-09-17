import { describe, expect, test } from 'bun:test'
import {
  availableQueueCapacity,
  executionProfileMarker,
  readExecutionProfileMarker,
  resolveExecutionProfile,
} from '@/lib/agent-execution'

describe('agent execution profiles', () => {
  test('scanner overrides inherit unspecified global defaults', () => {
    expect(
      resolveExecutionProfile(
        { model: 'anthropic/claude-opus-5' },
        { model: 'gpt-5.6-sol', effort: 'medium' },
      ),
    ).toEqual({ model: 'anthropic/claude-opus-5', effort: 'medium' })
  })

  test('round-trips a profile marker embedded in an agent task', () => {
    const profile = { model: 'gpt-5.6-sol', effort: 'high' } as const
    expect(
      readExecutionProfileMarker(
        `${executionProfileMarker(profile)}\nRun scan 7.`,
      ),
    ).toEqual(profile)
  })
})

describe('execution queue capacity', () => {
  test('dispatches only open slots and never returns negative capacity', () => {
    expect(availableQueueCapacity(3, 1)).toBe(2)
    expect(availableQueueCapacity(3, 3)).toBe(0)
    expect(availableQueueCapacity(3, 5)).toBe(0)
  })
})
