import { describe, expect, test } from 'bun:test'
import { scannerResultSchema } from './findings'
import {
  investigationAllowsResolution,
  scanCoverageSchema,
  scanTargetSchema,
  securityProfileSchema,
  targetIncludesPath,
} from './security-scans'

describe('scan targets', () => {
  test('matches exact files and descendants without crossing sibling prefixes', () => {
    const target = { kind: 'paths' as const, paths: ['src/auth'] }
    expect(targetIncludesPath(target, 'src/auth')).toBe(true)
    expect(targetIncludesPath(target, 'src/auth/session.ts')).toBe(true)
    expect(targetIncludesPath(target, 'src/authorize.ts')).toBe(false)
  })

  test('rejects traversal, absolute paths, and non-commit diff revisions', () => {
    expect(
      scanTargetSchema.safeParse({ kind: 'paths', paths: ['../secrets'] })
        .success,
    ).toBe(false)
    expect(
      scanTargetSchema.safeParse({ kind: 'paths', paths: ['/etc/passwd'] })
        .success,
    ).toBe(false)
    expect(
      scanTargetSchema.safeParse({ kind: 'diff', base: '--help', head: 'main' })
        .success,
    ).toBe(false)
  })
})

describe('investigation-aware lifecycle', () => {
  test('requires an explicit verdict inside the configured target', () => {
    expect(
      investigationAllowsResolution({
        explicitVerdict: true,
        target: { kind: 'paths', paths: ['src/auth'] },
        findingPaths: ['src/auth/session.ts'],
      }),
    ).toBe(true)
    expect(
      investigationAllowsResolution({
        explicitVerdict: true,
        target: { kind: 'paths', paths: ['src/auth'] },
        findingPaths: ['src/payments/card.ts'],
      }),
    ).toBe(false)
  })

  test('never infers resolution from absence in a bounded investigation', () => {
    expect(
      investigationAllowsResolution({
        explicitVerdict: false,
        findingPaths: ['src/auth/session.ts'],
      }),
    ).toBe(false)
  })

  test('supports explicit resolution for repository-level findings', () => {
    expect(
      investigationAllowsResolution({
        explicitVerdict: true,
        target: { kind: 'repository' },
        findingPaths: [],
      }),
    ).toBe(true)
  })

  test('does not resolve repository-level subjects in a path investigation', () => {
    expect(
      investigationAllowsResolution({
        explicitVerdict: true,
        target: { kind: 'paths', paths: ['src/auth'] },
        findingPaths: [],
        findingSubject: { kind: 'repository', aspect: 'module layout' },
      }),
    ).toBe(false)
  })
})

test('security profiles retain explicit empty defaults', () => {
  expect(
    securityProfileSchema.parse({ projectOverview: 'API service' }),
  ).toEqual({
    projectOverview: 'API service',
    assets: [],
    entryPoints: [],
    trustBoundaries: [],
    authAssumptions: [],
    sensitiveDataPaths: [],
    privilegedActions: [],
    securityInvariants: [],
    priorities: [],
    exclusions: [],
  })
})

test('scanner results support repository findings without file locations', () => {
  const result = scannerResultSchema.parse({
    summary: 'The module layout was investigated from repository structure.',
    findings: [
      {
        fingerprint: 'mixed-module-ownership',
        title: 'Feature and infrastructure ownership are mixed',
        severity: 'medium',
        confidence: 'high',
        description:
          'The root layout and dependency graph place unrelated responsibilities together.',
        whyItMatters: 'Routine changes cross ownership boundaries.',
        recommendation:
          'Separate feature ownership from infrastructure adapters.',
        effort: 'medium',
        subject: { kind: 'repository', aspect: 'module ownership' },
        evidence: [
          {
            kind: 'repository-structure',
            paths: ['src/features', 'src/lib'],
            summary: 'The same responsibilities are split across both roots.',
          },
        ],
        locations: [],
      },
    ],
    hypothesisVerdicts: [],
    investigation: {
      strategy:
        'Oriented from the tree and inspected representative dependency boundaries.',
      focusAreas: [{ kind: 'repository', aspect: 'module ownership' }],
      evidence: [],
      blindSpots: ['Runtime-only dependency injection'],
      confidence: 'medium',
    },
  })
  expect(result.findings[0]?.locations).toEqual([])
  expect(result.findings[0]?.subject.kind).toBe('repository')
})

test('coverage stores file references separately from their explanations', () => {
  const coverage = scanCoverageSchema.parse({
    completeness: 'partial',
    reviewed: [
      {
        path: 'src/auth/session.ts',
        startLine: 12,
        endLine: 38,
        summary: 'Session validation and cookie issuance.',
      },
    ],
    deferred: [
      {
        path: 'src/auth/oauth.ts',
        reason: 'Provider fixture was unavailable.',
      },
    ],
  })

  expect(coverage.reviewed[0]).toEqual({
    path: 'src/auth/session.ts',
    startLine: 12,
    endLine: 38,
    summary: 'Session validation and cookie issuance.',
  })
  expect(coverage.excluded).toEqual([])
  expect(
    scanCoverageSchema.safeParse({
      completeness: 'partial',
      reviewed: ['src/auth/session.ts: session handling'],
    }).success,
  ).toBe(false)
})
