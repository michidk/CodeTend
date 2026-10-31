import { describe, expect, test } from 'bun:test'
import {
  compareByLastScan,
  isScheduleDispatchReady,
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

  test('orders unrated repositories by oldest attempt, with unattempted first', () => {
    const repos = [
      { id: 1, hasRating: false, lastScanAt: new Date('2026-09-13T00:00:00Z') },
      { id: 2, hasRating: false, lastScanAt: new Date('2026-09-01T00:00:00Z') },
      { id: 4, hasRating: false, lastScanAt: null },
      { id: 3, hasRating: false, lastScanAt: null },
    ]
    expect(repos.sort(compareByLastScan).map((repo) => repo.id)).toEqual([
      3, 4, 2, 1,
    ])
  })
})

test('prioritizes missing ratings over older rated repositories', () => {
  const repos = [
    { id: 1, hasRating: true, lastScanAt: new Date('2026-08-01T00:00:00Z') },
    { id: 2, hasRating: false, lastScanAt: new Date('2026-09-13T00:00:00Z') },
    { id: 3, hasRating: false, lastScanAt: new Date('2026-09-12T00:00:00Z') },
    { id: 4, hasRating: true, lastScanAt: new Date('2026-07-01T00:00:00Z') },
  ]
  expect(repos.sort(compareByLastScan).map((repo) => repo.id)).toEqual([
    3, 2, 4, 1,
  ])
})
