import { describe, expect, test } from 'bun:test'
import {
  customScannerSchema,
  resolveScannerConfigurations,
} from '@/lib/scanner-configuration'

const custom = {
  id: 'accessibility',
  name: 'Accessibility',
  shortName: 'A11y',
  description: 'Accessible interaction and presentation patterns.',
  weight: 1,
  prompt: 'Review accessibility across every user-facing interaction.',
  fixPromptTitle: 'Fix Accessibility Issues',
}

describe('scanner configuration', () => {
  test('applies built-in enable overrides and appends custom scanners', () => {
    const scanners = resolveScannerConfigurations([
      { scannerId: 'architecture', enabled: false, definition: null },
      { scannerId: custom.id, enabled: true, definition: custom },
    ])

    expect(
      scanners.find((scanner) => scanner.id === 'architecture')?.enabled,
    ).toBe(false)
    expect(scanners.at(-1)).toMatchObject({
      ...custom,
      enabled: true,
      kind: 'agent',
      custom: true,
    })
  })

  test('rejects ids that are unsafe as agent keys and URL segments', () => {
    expect(
      customScannerSchema.safeParse({ ...custom, id: 'A bad/id' }).success,
    ).toBe(false)
  })

  test('ignores malformed persisted custom definitions', () => {
    const scanners = resolveScannerConfigurations([
      {
        scannerId: 'broken',
        enabled: true,
        definition: { ...custom, id: 'different-id' },
      },
    ])
    expect(scanners.some((scanner) => scanner.id === 'broken')).toBe(false)
  })
})
