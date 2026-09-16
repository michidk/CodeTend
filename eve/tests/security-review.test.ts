import { describe, expect, test } from 'bun:test'
import {
  applyExploitabilityReview,
  exploitabilityReviewMessage,
} from '../agent/lib/security-review'

const finding = {
  fingerprint: 'unsafe-shell-boundary',
  title: 'Shell command accepts request data',
  severity: 'high',
  confidence: 'high',
  description: 'A request parameter is interpolated into a shell command.',
  whyItMatters: 'An attacker may execute commands on the server.',
  recommendation: 'Pass arguments without invoking a shell.',
  effort: 'small',
  subject: { kind: 'file', path: 'src/run.ts' },
  evidence: [],
  locations: [{ path: 'src/run.ts', startLine: 12 }],
  securityContext: {
    reachability: 'confirmed',
    exposure: 'internet',
    dataSensitivity: 'high',
  },
}

describe('security exploitability review', () => {
  test('asks for an independent practical attack-path decision', () => {
    const prompt = exploitabilityReviewMessage({
      repoPath: '/workspace/repos/example',
      repositoryName: 'example',
      findings: [finding],
      validations: [],
      securityProfile: {
        projectOverview: 'Internet-facing API',
        assets: [],
        entryPoints: ['Public HTTP API'],
        trustBoundaries: [],
        authAssumptions: [],
        sensitiveDataPaths: [],
        privilegedActions: [],
        securityInvariants: [],
        priorities: [],
        exclusions: [],
      },
      gitnexusRepo: 'repo-1-scan-2',
    })

    expect(prompt).toContain(
      '# Scanner: Security exploitability review (id: security)',
    )
    expect(prompt).toContain('Do not trust the original severity')
    expect(prompt).toContain('You must inspect the repository files')
    expect(prompt).toContain('repository-relative code evidence')
    expect(prompt).toContain('default to `not-confirmed`')
    expect(prompt).toContain('unsafe-shell-boundary')
    expect(prompt).toContain('Internet-facing API')
    expect(prompt).toContain('repo-1-scan-2')
  })

  test('attaches confirmed and unconfirmed verdicts to their findings', () => {
    const result = { summary: 'Security scan', findings: [finding] }
    const reviewed = applyExploitabilityReview(
      result,
      {
        assessments: [
          {
            fingerprint: 'unsafe-shell-boundary',
            verdict: 'confirmed',
            rationale: 'The public route passes attacker input to exec().',
            inspectedEvidence: [
              {
                path: 'src/run.ts',
                startLine: 12,
                role: 'source',
                summary: 'Reads the attacker-controlled request parameter.',
              },
              {
                path: 'src/run.ts',
                startLine: 18,
                role: 'sink',
                summary: 'Passes the value to exec without escaping.',
              },
            ],
          },
        ],
      },
      ['src/run.ts'],
    )

    expect(reviewed.findings[0]?.exploitability).toEqual({
      verdict: 'confirmed',
      rationale: 'The public route passes attacker input to exec().',
    })
  })

  test('marks omitted assessments as not confirmed', () => {
    const reviewed = applyExploitabilityReview(
      { summary: 'Security scan', findings: [finding] },
      { assessments: [] },
      ['src/run.ts'],
    )

    expect(reviewed.findings[0]?.exploitability.verdict).toBe('not-confirmed')
  })

  test('rejects a confirmed verdict without inspected source and sink evidence', () => {
    const reviewed = applyExploitabilityReview(
      { summary: 'Security scan', findings: [finding] },
      {
        assessments: [
          {
            fingerprint: 'unsafe-shell-boundary',
            verdict: 'confirmed',
            rationale: 'The candidate description claims an attack path.',
            inspectedEvidence: [],
          },
        ],
      },
      ['src/run.ts'],
    )

    expect(reviewed.findings[0]?.exploitability.verdict).toBe('not-confirmed')
  })

  test('rejects evidence paths that are not present in the checkout', () => {
    const reviewed = applyExploitabilityReview(
      { summary: 'Security scan', findings: [finding] },
      {
        assessments: [
          {
            fingerprint: 'unsafe-shell-boundary',
            verdict: 'confirmed',
            rationale: 'A source and sink were claimed in an invented file.',
            inspectedEvidence: [
              {
                path: 'src/invented.ts',
                role: 'source',
                summary: 'Claimed request source.',
              },
              {
                path: 'src/invented.ts',
                role: 'sink',
                summary: 'Claimed execution sink.',
              },
            ],
          },
        ],
      },
      ['src/run.ts'],
    )

    expect(reviewed.findings[0]?.exploitability.verdict).toBe('not-confirmed')
  })
})
