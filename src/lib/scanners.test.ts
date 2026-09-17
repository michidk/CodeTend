import { describe, expect, test } from 'bun:test'
import { agentScanners, getScanner, SCANNERS } from '@/lib/scanners'

describe('scanner registry', () => {
  test('ids are unique', () => {
    const ids = SCANNERS.map((scanner) => scanner.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('every agent scanner delimits its dimension against its neighbours', () => {
    for (const scanner of agentScanners) {
      expect(scanner.prompt).toContain('Not yours')
      expect(scanner.prompt).toContain('Calibrate')
    }
  })

  test('neighbouring dimensions hand statement-level noise to the slop scanner', () => {
    for (const id of [
      'duplication',
      'dead-code',
      'complexity',
      'reliability',
      'consistency',
    ]) {
      expect(getScanner(id)?.prompt).toContain('(AI Slop & Noise)')
    }
  })

  test('slop scanner is enabled and judges patterns, not provenance', () => {
    const slop = getScanner('slop')
    expect(slop?.enabled).toBe(true)
    expect(slop?.kind).toBeUndefined()
    expect(slop?.prompt).toContain('never its provenance')
    expect(slop?.fixGuidance).toContain('Prefer deletion over addition')
  })

  test('security discovery frames findings as independently reviewed hypotheses', () => {
    const security = getScanner('security')
    expect(security?.prompt).toContain('independent agent')
    expect(security?.prompt).toContain('practical exploitability')
    expect(security?.prompt).toContain(
      'distinguish observed code from assumptions',
    )
  })

  test('CI security scanner traces workflow trust boundaries without overlapping neighbours', () => {
    const scanner = getScanner('ci-security')
    expect(scanner?.enabled).toBe(true)
    expect(scanner?.kind).toBeUndefined()
    expect(scanner?.prompt).toContain('pull_request_target')
    expect(scanner?.prompt).toContain('full commit-SHA pins')
    expect(scanner?.prompt).toContain('external actor or lower-trust producer')
    expect(scanner?.prompt).toContain('(Dependencies & Build Health)')
    expect(scanner?.prompt).toContain('(Tests & Testability)')
    expect(scanner?.prompt).toContain('(Security Hygiene)')
    expect(scanner?.fixGuidance).toContain('full 40-character commit SHA')
    expect(scanner?.fixGuidance).toContain('read-only')
  })
})
