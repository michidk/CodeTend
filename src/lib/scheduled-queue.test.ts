import { describe, expect, test } from 'bun:test'
import {
  isScheduleDispatchReady,
  selectNextDistributedRepositoryId,
} from '@/lib/scheduled-queue'

describe('scheduled repository queue', () => {
  const now = new Date('2026-09-14T12:00:00Z')

  test('allows the first dispatch immediately', () => {
    expect(isScheduleDispatchReady(null, 5, now)).toBe(true)
  })

  test('waits for the configured cooldown', () => {
    expect(
      isScheduleDispatchReady(new Date('2026-09-14T11:56:00Z'), 5, now),
    ).toBe(false)
    expect(
      isScheduleDispatchReady(new Date('2026-09-14T11:55:00Z'), 5, now),
    ).toBe(true)
  })

  test('allows every scheduler tick when cooldown is zero', () => {
    expect(isScheduleDispatchReady(now, 0, now)).toBe(true)
  })

  test('rotates distributed scans through repository ids and wraps', () => {
    expect(selectNextDistributedRepositoryId([9, 2, 5], null)).toBe(2)
    expect(selectNextDistributedRepositoryId([9, 2, 5], 2)).toBe(5)
    expect(selectNextDistributedRepositoryId([9, 2, 5], 9)).toBe(2)
    expect(selectNextDistributedRepositoryId([], 9)).toBeNull()
  })
})
