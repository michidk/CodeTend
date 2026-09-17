import { describe, expect, test } from 'bun:test'
import {
  applyDependencyImpactReviews,
  dependencyImpactCandidates,
  dependencyImpactReviewBatches,
  dependencyImpactReviewMessage,
} from '../agent/lib/dependency-security-review'

const report = {
  results: [
    {
      source: { path: '/repo/bun.lock', type: 'lockfile' },
      packages: [
        {
          package: { ecosystem: 'npm', name: 'tar', version: '7.4.3' },
          groups: [
            {
              ids: ['GHSA-23hp-3jrh-7fpw'],
              aliases: ['CVE-2026-59873'],
            },
          ],
          vulnerabilities: [
            {
              id: 'GHSA-23hp-3jrh-7fpw',
              aliases: ['CVE-2026-59873'],
              summary: 'Decompression denial of service',
              details: 'Untrusted archives can exhaust resources.',
            },
          ],
        },
      ],
    },
  ],
}

describe('dependency vulnerability impact review', () => {
  test('extracts stable compact package and advisory candidates', () => {
    const candidates = dependencyImpactCandidates(report)

    expect(candidates).toEqual([
      {
        id: 'dependency-1',
        package: { ecosystem: 'npm', name: 'tar', version: '7.4.3' },
        advisoryIds: ['CVE-2026-59873', 'GHSA-23hp-3jrh-7fpw'],
        summary: 'Decompression denial of service',
        details: 'Untrusted archives can exhaust resources.',
      },
    ])
    expect(dependencyImpactReviewBatches(candidates)).toHaveLength(1)
  })

  test('requires inspection of actual usage and attacker-controlled input', () => {
    const prompt = dependencyImpactReviewMessage({
      repoPath: '/workspace/repo',
      repositoryName: 'example/site',
      candidates: dependencyImpactCandidates(report),
      securityProfile: {
        projectOverview: 'Public site with a trusted CSS build pipeline',
        assets: [],
        entryPoints: [],
        trustBoundaries: [],
        authAssumptions: [],
        sensitiveDataPaths: [],
        privilegedActions: [],
        securityInvariants: [],
        priorities: [],
        exclusions: [],
      },
      gitnexusRepo: 'repo-5-scan-23',
    })

    expect(prompt).toContain('actual impact')
    expect(prompt).toContain('attacker-controlled source')
    expect(prompt).toContain('Trusted author-only build, test, lint')
    expect(prompt).toContain('manifests, lockfiles, imports, call sites')
    expect(prompt).toContain('repo-5-scan-23')
  })

  test('confirms only reviews with repository-present source and sink evidence', () => {
    const [candidate] = dependencyImpactCandidates(report)
    expect(candidate).toBeDefined()
    if (!candidate) return

    const assessments = applyDependencyImpactReviews(
      [candidate],
      [
        {
          assessments: [
            {
              candidateId: candidate.id,
              verdict: 'confirmed',
              rationale: 'A public upload reaches the vulnerable extractor.',
              inspectedEvidence: [
                {
                  path: 'src/upload.ts',
                  role: 'source',
                  summary:
                    'Accepts an archive from an unauthenticated request.',
                },
                {
                  path: 'src/extract.ts',
                  role: 'sink',
                  summary: 'Passes the archive to the vulnerable tar parser.',
                },
              ],
            },
          ],
        },
      ],
      ['src/upload.ts', 'src/extract.ts'],
    )

    expect(assessments[0]).toMatchObject({
      verdict: 'confirmed',
      advisoryIds: ['CVE-2026-59873', 'GHSA-23hp-3jrh-7fpw'],
    })
  })

  test('fails closed for missing or invented attack-path evidence', () => {
    const [candidate] = dependencyImpactCandidates(report)
    expect(candidate).toBeDefined()
    if (!candidate) return

    const [invented] = applyDependencyImpactReviews(
      [candidate],
      [
        {
          assessments: [
            {
              candidateId: candidate.id,
              verdict: 'confirmed',
              rationale: 'Claims a runtime path without repository evidence.',
              inspectedEvidence: [
                {
                  path: 'src/invented.ts',
                  role: 'source',
                  summary: 'Invented request source.',
                },
                {
                  path: 'src/invented.ts',
                  role: 'sink',
                  summary: 'Invented vulnerable sink.',
                },
              ],
            },
          ],
        },
      ],
      ['package.json'],
    )
    const [missing] = applyDependencyImpactReviews(
      [candidate],
      [],
      ['package.json'],
    )

    expect(invented?.verdict).toBe('not-confirmed')
    expect(missing?.verdict).toBe('not-confirmed')
  })
})
