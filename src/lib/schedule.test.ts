import { describe, expect, test } from 'bun:test'
import {
  CRON_PRESETS,
  computeNextDistributedScanAt,
  computeNextScanAt,
  isValidCronExpression,
} from '@/lib/schedule'
import { describeCron } from '@/lib/schedule-presets'

describe('cron schedules', () => {
  test('every preset is a valid expression with a label', () => {
    for (const preset of CRON_PRESETS) {
      expect(isValidCronExpression(preset.value)).toBe(true)
      expect(describeCron(preset.value)).toBe(preset.label)
    }
  })

  test('rejects malformed expressions', () => {
    expect(isValidCronExpression('every day')).toBe(false)
    expect(isValidCronExpression('0 25 * * *')).toBe(false)
    expect(isValidCronExpression('0 3 * * 8')).toBe(false)
  })

  test('falls back to the raw expression for unknown schedules', () => {
    expect(describeCron('15 4 * * *')).toBe('15 4 * * *')
  })

  test('computes the next occurrence strictly after the reference in UTC', () => {
    const from = new Date('2026-09-12T03:00:00.000Z')
    expect(computeNextScanAt('0 3 * * *', from).toISOString()).toBe(
      '2026-09-13T03:00:00.000Z',
    )
    expect(computeNextScanAt('0 */6 * * *', from).toISOString()).toBe(
      '2026-09-12T06:00:00.000Z',
    )
    // 2026-09-12 is a Saturday; weekdays-only rolls over to Monday.
    expect(computeNextScanAt('0 6 * * 1-5', from).toISOString()).toBe(
      '2026-09-14T06:00:00.000Z',
    )
  })

  test('spaces distributed scans evenly across a UTC day', () => {
    const from = new Date('2026-09-17T00:00:00.000Z')
    expect(computeNextDistributedScanAt(1, from).toISOString()).toBe(
      '2026-09-17T03:00:00.000Z',
    )
    expect(computeNextDistributedScanAt(4, from).toISOString()).toBe(
      '2026-09-17T06:00:00.000Z',
    )
    expect(() => computeNextDistributedScanAt(0, from)).toThrow()
  })
})

describe('nightly distributed scans', () => {
  test.each([
    ['2026-11-05T02:59:59.999Z', '2026-11-05T03:00:00.000Z'],
    ['2026-11-05T03:00:00.000Z', '2026-11-06T03:00:00.000Z'],
    ['2026-11-05T03:00:27.223Z', '2026-11-06T03:00:00.000Z'],
    ['2026-11-05T10:13:27.223Z', '2026-11-06T03:00:00.000Z'],
    ['2026-12-31T23:59:59.000Z', '2027-01-01T03:00:00.000Z'],
  ])('keeps the overnight slot after %s', (from, expected) => {
    expect(computeNextDistributedScanAt(1, new Date(from)).toISOString()).toBe(
      expected,
    )
  })
})
