import { describe, expect, test } from 'bun:test'
import { scanProgressPercent } from '@/lib/scan-progress'

describe('scan progress', () => {
  test('calculates determinate workflow completion', () => {
    expect(
      scanProgressPercent({ phase: 'scanning', completed: 6, total: 12 }),
    ).toBe(50)
  })

  test('clamps malformed or transitional values', () => {
    expect(
      scanProgressPercent({ phase: 'queued', completed: 0, total: 0 }),
    ).toBe(0)
    expect(
      scanProgressPercent({ phase: 'done', completed: 12, total: 10 }),
    ).toBe(100)
  })
})
