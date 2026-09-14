import { describe, expect, test } from 'bun:test'
import {
  coverageAllowsResolution,
  scanTargetSchema,
  securityProfileSchema,
  targetIncludesPath,
} from './security-scans'

const completeCoverage = {
  completeness: 'complete' as const,
  reviewed: ['src/auth'],
  deferred: [],
  excluded: [],
  openQuestions: [],
}

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

describe('coverage-aware lifecycle', () => {
  test('resolves only findings positively covered by the target', () => {
    expect(
      coverageAllowsResolution({
        coverage: completeCoverage,
        target: { kind: 'paths', paths: ['src/auth'] },
        findingPaths: ['src/auth/session.ts'],
      }),
    ).toBe(true)
    expect(
      coverageAllowsResolution({
        coverage: completeCoverage,
        target: { kind: 'paths', paths: ['src/auth'] },
        findingPaths: ['src/payments/card.ts'],
      }),
    ).toBe(false)
  })

  test('never resolves through partial, deferred, or out-of-diff coverage', () => {
    expect(
      coverageAllowsResolution({
        coverage: { ...completeCoverage, completeness: 'partial' },
        findingPaths: ['src/auth/session.ts'],
      }),
    ).toBe(false)
    expect(
      coverageAllowsResolution({
        coverage: {
          ...completeCoverage,
          deferred: [
            { path: 'src/auth', reason: 'generated code unavailable' },
          ],
        },
        findingPaths: ['src/auth/session.ts'],
      }),
    ).toBe(false)
    expect(
      coverageAllowsResolution({
        coverage: completeCoverage,
        target: { kind: 'diff', base: '1'.repeat(40), head: '2'.repeat(40) },
        targetFiles: ['src/routes.ts'],
        findingPaths: ['src/auth/session.ts'],
      }),
    ).toBe(false)
  })

  test('never resolves a finding outside an explicit review sample', () => {
    expect(
      coverageAllowsResolution({
        coverage: completeCoverage,
        target: { kind: 'repository' },
        targetFiles: ['src/routes.ts'],
        findingPaths: ['src/auth/session.ts'],
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
