import { describe, expect, test } from 'bun:test'
import { compareFindingsBySeverity } from '@/lib/server/repository-detail'

describe('compareFindingsBySeverity', () => {
  test('orders higher severities first, regardless of contextual priority', () => {
    const findings = [
      { title: 'Low but prioritized', severity: 'low', priority: 'critical' },
      { title: 'Medium finding', severity: 'medium', priority: null },
      { title: 'Critical finding', severity: 'critical', priority: null },
      { title: 'High finding', severity: 'high', priority: 'low' },
    ] as const

    expect([...findings].sort(compareFindingsBySeverity)).toEqual([
      findings[2],
      findings[3],
      findings[1],
      findings[0],
    ])
  })

  test('uses priority and title to keep equal severities deterministic', () => {
    const findings = [
      { title: 'Zulu', severity: 'high', priority: null },
      { title: 'Alpha', severity: 'high', priority: null },
      { title: 'Prioritized', severity: 'high', priority: 'medium' },
    ] as const

    expect(
      [...findings].sort(compareFindingsBySeverity).map(({ title }) => title),
    ).toEqual(['Prioritized', 'Alpha', 'Zulu'])
  })
})
