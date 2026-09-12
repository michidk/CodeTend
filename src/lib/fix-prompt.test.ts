import { describe, expect, test } from 'bun:test'
import {
  buildFixPrompt,
  type FixPromptFinding,
  formatLocation,
} from '@/lib/fix-prompt'

const scanner = {
  name: 'Architecture & Modularity',
  fixPromptTitle: 'Fix Architecture Issues',
  fixGuidance: undefined,
}

function finding(overrides: Partial<FixPromptFinding>): FixPromptFinding {
  return {
    title: 'Cyclic import between auth and billing',
    severity: 'medium',
    confidence: 'high',
    description: 'auth imports billing which imports auth.',
    whyItMatters: 'Neither module can be tested or replaced alone.',
    recommendation: 'Move the shared session type into a leaf module.',
    effort: 'small',
    locations: [{ path: 'src/auth/index.ts', startLine: 3 }],
    ...overrides,
  }
}

describe('formatLocation', () => {
  test('renders path, line range and symbol compactly', () => {
    expect(formatLocation({ path: 'src/a.ts' })).toBe('src/a.ts')
    expect(formatLocation({ path: 'src/a.ts', startLine: 4 })).toBe(
      'src/a.ts:4',
    )
    expect(formatLocation({ path: 'src/a.ts', startLine: 4, endLine: 4 })).toBe(
      'src/a.ts:4',
    )
    expect(
      formatLocation({
        path: 'src/a.ts',
        startLine: 4,
        endLine: 9,
        symbol: 'loadUser',
      }),
    ).toBe('src/a.ts:4-9 (loadUser)')
  })
})

describe('buildFixPrompt', () => {
  const base = {
    scanner,
    repositoryName: 'acme/shop',
    repositoryUrl: 'https://github.com/acme/shop',
    branch: 'main',
    commitSha: 'abcdef1234567890',
  }

  test('says so when there is nothing to fix', () => {
    const prompt = buildFixPrompt({ ...base, findings: [] })
    expect(prompt).toStartWith('# Fix Architecture Issues')
    expect(prompt).toContain('analyzed at commit `abcdef123456`')
    expect(prompt).toContain('No open findings.')
  })

  test('orders findings by priority, then severity', () => {
    const prompt = buildFixPrompt({
      ...base,
      commitSha: null,
      findings: [
        finding({ title: 'Low severity, no priority', severity: 'low' }),
        finding({
          title: 'Critical severity, no priority',
          severity: 'critical',
        }),
        finding({
          title: 'Medium severity, high priority',
          severity: 'medium',
          priority: 'high',
          priorityScore: 72,
          priorityReasons: ['reachable from HTTP'],
        }),
      ],
    })
    const order = [
      prompt.indexOf('### 1. Medium severity, high priority'),
      prompt.indexOf('### 2. Critical severity, no priority'),
      prompt.indexOf('### 3. Low severity, no priority'),
    ]
    expect(order.every((index) => index >= 0)).toBe(true)
    expect(prompt).toContain('- Priority: high (72/100) · reachable from HTTP')
    expect(prompt).not.toContain('analyzed at commit')
  })

  test('includes scanner-specific guidance and vulnerability metadata', () => {
    const prompt = buildFixPrompt({
      ...base,
      scanner: {
        ...scanner,
        name: 'Vulnerable Dependencies',
        fixGuidance:
          'Prefer the smallest version bump that removes the advisory.',
      },
      findings: [
        finding({
          classification: { cwes: ['CWE-1395'], owasp: [] },
          vulnerability: {
            package: {
              ecosystem: 'npm',
              name: 'lodash',
              version: '4.17.20',
              purl: 'pkg:npm/lodash@4.17.20',
            },
            advisories: [{ id: 'GHSA-35jh-r3h4-6jhm' }],
            match: {
              confidence: 'high',
              method: 'lockfile',
              evidence: ['package-lock.json'],
            },
            cvss: [{ version: '3.1', score: 7.2, vector: 'CVSS:3.1/AV:N' }],
            epss: [{ probability: 0.0123, percentile: 0.85 }],
            kev: [{ dateAdded: '2026-01-02', dueDate: '2026-01-23' }],
          } as unknown as FixPromptFinding['vulnerability'],
        }),
      ],
    })
    expect(prompt).toContain('## Handling Vulnerable Dependencies findings')
    expect(prompt).toContain('Prefer the smallest version bump')
    expect(prompt).toContain('- Classification: CWE-1395')
    expect(prompt).toContain(
      '- Vulnerable package: npm/lodash@4.17.20 · pkg:npm/lodash@4.17.20',
    )
    expect(prompt).toContain('- Advisories: GHSA-35jh-r3h4-6jhm')
    expect(prompt).toContain('- CVSS 3.1: 7.2 · CVSS:3.1/AV:N')
    expect(prompt).toContain('- EPSS: 1.23% probability · 85.0th percentile')
    expect(prompt).toContain(
      '- CISA KEV: added 2026-01-02 · remediation due 2026-01-23',
    )
  })
})
