import { describe, expect, test } from 'bun:test'
import {
  patchResultSchema,
  type ScanRequest,
  scanCheckpointSchema,
  scanRequestSchema,
  scanResultSchema,
} from '@/lib/eve-protocol'

const request: ScanRequest = {
  contractVersion: 1,
  scanId: 7,
  repositoryId: 3,
  repositoryName: 'example/repository',
  repositoryUrl: 'https://github.com/example/repository.git',
  branch: 'main',
  gitnexus: false,
  knowledge: null,
  previousCommitSha: null,
  target: { kind: 'repository' },
  maxInputTokens: 10_000,
  maxCostUsd: null,
  securityProfile: null,
  validation: { enabled: false, runner: 'disabled', image: 'unused' },
  dependencyAudit: false,
  scanners: [],
  outputSchema: {},
}

describe('Eve protocol', () => {
  test('accepts a current scan request on both sides of the boundary', () => {
    expect(scanRequestSchema.parse(request)).toEqual(request)
  })

  test('rejects an incompatible request version before workflow access', () => {
    const result = scanRequestSchema.safeParse({
      ...request,
      contractVersion: 2,
    })

    expect(result.success).toBe(false)
  })

  test('rejects malformed durable checkpoints', () => {
    const result = scanCheckpointSchema.safeParse({
      version: 1,
      scanId: 7,
      requestFingerprint: '',
    })

    expect(result.success).toBe(false)
  })

  test('defaults dependency impact assessments for older scan results', () => {
    const parsed = scanResultSchema.shape.dependencyAudit.parse({
      status: 'completed',
      report: { results: [] },
    })

    expect(parsed.exploitabilityAssessments).toEqual([])
  })

  test('preserves dependency impact assessments across the protocol', () => {
    const parsed = scanResultSchema.shape.dependencyAudit.parse({
      status: 'completed',
      report: { results: [] },
      exploitabilityAssessments: [
        {
          package: { ecosystem: 'npm', name: 'tar', version: '7.4.3' },
          advisoryIds: ['CVE-2026-59873'],
          verdict: 'not-confirmed',
          rationale: 'Only reachable from the trusted CSS build pipeline.',
          inspectedEvidence: [
            {
              path: 'package.json',
              role: 'supporting',
              summary: 'Declares the build-only package path.',
            },
          ],
        },
      ],
    })

    expect(parsed.exploitabilityAssessments[0]?.package.name).toBe('tar')
  })

  test('allows review states but not publication in fixer results', () => {
    const base = {
      patchId: 4,
      summary: 'Generated a focused fix.',
      diff: 'diff --git a/a.ts b/a.ts',
      changedFiles: ['a.ts'],
      testRecommendations: [],
      verification: null,
      finishedAt: '2026-09-17T00:00:00.000Z',
    }

    expect(
      patchResultSchema.safeParse({ ...base, status: 'proposed' }).success,
    ).toBe(true)
    expect(
      patchResultSchema.safeParse({ ...base, status: 'verified' }).success,
    ).toBe(true)
    expect(
      patchResultSchema.safeParse({ ...base, status: 'published' }).success,
    ).toBe(false)
  })
})
