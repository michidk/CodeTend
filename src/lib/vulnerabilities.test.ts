import { describe, expect, test } from 'bun:test'
import type { EpssMetric, KevEntry } from '@/lib/findings'
import {
  cveIdsForMatches,
  dependencyFindingsFromMatches,
  deriveDependencyPriority,
  deriveSourcePriority,
  parseOsvDependencyReport,
  scoreCvssVector,
} from '@/lib/vulnerabilities'

const REPORT = {
  results: [
    {
      source: {
        path: '/data/workspaces/repo-7-scan-12/bun.lock',
        type: 'lockfile',
      },
      packages: [
        {
          package: { ecosystem: 'npm', name: 'demo-package', version: '1.2.3' },
          groups: [
            {
              ids: ['GHSA-abcd-1234-5678'],
              aliases: ['CVE-2025-12345'],
              max_severity: '5.3',
            },
          ],
          vulnerabilities: [
            {
              id: 'GHSA-abcd-1234-5678',
              aliases: ['CVE-2025-12345'],
              summary: 'A test vulnerability',
              published: '2025-01-02T00:00:00Z',
              modified: '2025-02-03T00:00:00Z',
              database_specific: { cwe_ids: ['CWE-346'], severity: 'MODERATE' },
              severity: [
                {
                  type: 'CVSS_V3',
                  score: 'CVSS:3.1/AV:N/AC:H/PR:N/UI:R/S:U/C:H/I:N/A:N',
                },
              ],
              affected: [
                {
                  package: {
                    ecosystem: 'npm',
                    name: 'demo-package',
                    purl: 'pkg:npm/demo-package',
                  },
                  ranges: [
                    {
                      type: 'SEMVER',
                      events: [{ introduced: '0' }, { fixed: '1.2.4' }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
}

describe('OSV dependency findings', () => {
  test('treats a repository without lockfiles as an empty audit', () => {
    // osv-scanner --allow-no-lockfiles emits `results: null` when nothing scanned.
    expect(
      parseOsvDependencyReport(
        { results: null, experimental_config: {} },
        '/data/workspaces/repo-7-scan-12',
      ),
    ).toEqual([])
  })

  test('normalizes exact package evidence and joins published intelligence', () => {
    const matches = parseOsvDependencyReport(
      REPORT,
      '/data/workspaces/repo-7-scan-12',
    )
    expect(matches).toHaveLength(1)
    expect(matches[0]?.manifestPath).toBe('bun.lock')
    expect(cveIdsForMatches(matches)).toEqual(['CVE-2025-12345'])

    const epss: EpssMetric = {
      cve: 'CVE-2025-12345',
      probability: 0.2,
      percentile: 0.92,
      date: '2026-09-09',
    }
    const kev: KevEntry = {
      cve: 'CVE-2025-12345',
      dateAdded: '2026-09-01',
      dueDate: '2026-09-20',
      requiredAction: 'Apply the vendor update.',
      knownRansomwareCampaignUse: 'Unknown',
    }
    const findings = dependencyFindingsFromMatches(
      matches,
      {
        epssByCve: new Map([[epss.cve, epss]]),
        kevByCve: new Map([[kev.cve, kev]]),
      },
      '2026-09-10T00:00:00Z',
    )

    expect(findings).toHaveLength(1)
    expect(findings[0]?.title).toBe('CVE-2025-12345 affects demo-package 1.2.3')
    expect(findings[0]?.classification?.cwes).toEqual(['CWE-346'])
    expect(findings[0]?.vulnerability?.package.purl).toBe(
      'pkg:npm/demo-package',
    )
    expect(findings[0]?.vulnerability?.fixedVersions).toEqual(['1.2.4'])
    expect(findings[0]?.vulnerability?.cvss[0]?.score).toBe(5.3)
    expect(findings[0]?.priority).toBe('critical')
    expect(findings[0]?.priorityScore).toBeGreaterThanOrEqual(95)
  })
})

describe('CVSS and contextual priority', () => {
  test('calculates CVSS 3.1 from the published vector', () => {
    expect(
      scoreCvssVector('CVSS:3.1/AV:N/AC:H/PR:N/UI:R/S:U/C:H/I:N/A:N'),
    ).toMatchObject({ version: '3.1', score: 5.3, severity: 'medium' })
    expect(scoreCvssVector('not-a-vector')).toBeNull()
  })

  test('keeps severity and priority as separate values', () => {
    const priority = deriveDependencyPriority({
      cvssScore: 9.8,
      severity: 'critical',
      epss: [],
      kev: [],
      fixedVersions: [],
    })
    expect(priority.priority).toBe('high')
    expect(priority.score).toBe(74)
  })

  test('raises source priority from grounded exposure context', () => {
    const priority = deriveSourcePriority({
      severity: 'high',
      confidence: 'high',
      exploitability: {
        verdict: 'confirmed',
        rationale: 'An unauthenticated HTTP request reaches the sink.',
      },
      context: {
        reachability: 'confirmed',
        exposure: 'internet',
        dataSensitivity: 'high',
      },
    })
    expect(priority).toMatchObject({ priority: 'critical', score: 88 })
    expect(priority.reasons).toContain('Internet exposed')
  })

  test('defaults source findings to low priority without confirmed exploitability', () => {
    const priority = deriveSourcePriority({
      severity: 'critical',
      confidence: 'high',
      context: {
        reachability: 'confirmed',
        exposure: 'internet',
        dataSensitivity: 'high',
      },
    })

    expect(priority).toMatchObject({ priority: 'low', score: 20 })
    expect(priority.reasons).toContain(
      'Exploitability review did not confirm a practical attack path',
    )
  })
})
