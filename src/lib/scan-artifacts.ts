import { createHash } from 'node:crypto'

export function artifactSha256(contents: string): string {
  return createHash('sha256').update(contents).digest('hex')
}

export interface SarifFinding {
  readonly ruleId: string
  readonly fingerprint: string
  readonly title: string
  readonly summary: string
  readonly severity: string
  readonly locations: readonly {
    readonly path: string
    readonly startLine?: number
    readonly endLine?: number
  }[]
}

export function toSarifDocument(
  repositoryUrl: string,
  revision: string,
  findings: readonly SarifFinding[],
) {
  return {
    version: '2.1.0' as const,
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    runs: [
      {
        tool: {
          driver: {
            name: 'tecdebt',
            informationUri: repositoryUrl,
            rules: findings.map((finding) => ({
              id: finding.ruleId,
              name: finding.fingerprint,
              shortDescription: { text: finding.title },
              fullDescription: { text: finding.summary },
            })),
          },
        },
        versionControlProvenance: [
          { repositoryUri: repositoryUrl, revisionId: revision },
        ],
        results: findings.map((finding) => ({
          ruleId: finding.ruleId,
          level: sarifLevel(finding.severity),
          message: { text: finding.summary },
          partialFingerprints: { primaryLocationLineHash: finding.fingerprint },
          locations: finding.locations.map((location) => ({
            physicalLocation: {
              artifactLocation: { uri: location.path },
              region: {
                startLine: location.startLine ?? 1,
                ...(location.endLine ? { endLine: location.endLine } : {}),
              },
            },
          })),
        })),
      },
    ],
  }
}

function sarifLevel(severity: string): 'error' | 'warning' | 'note' {
  if (severity === 'critical' || severity === 'high') return 'error'
  if (severity === 'medium') return 'warning'
  return 'note'
}

export function toMarkdownScanReport(input: {
  readonly repository: string
  readonly revision: string
  readonly mode: string
  readonly target: unknown
  readonly coverage: {
    readonly completeness: string
    readonly deferred: readonly unknown[]
    readonly openQuestions: readonly string[]
  }
  readonly findings: readonly {
    readonly title: string
    readonly severity: string
    readonly summary: string
    readonly remediation: string
  }[]
}): string {
  const lines = [
    `# Security scan: ${input.repository}`,
    '',
    `- Revision: \`${input.revision}\``,
    `- Mode: ${input.mode}`,
    `- Target: \`${JSON.stringify(input.target)}\``,
    `- Coverage: ${input.coverage.completeness}`,
    `- Findings: ${input.findings.length}`,
    '',
  ]
  if (input.coverage.deferred.length > 0) {
    lines.push(
      '## Deferred coverage',
      '',
      'See `coverage.json` for the complete reasons.',
      '',
    )
  }
  for (const finding of input.findings) {
    lines.push(
      `## ${finding.title}`,
      '',
      `Severity: **${finding.severity}**`,
      '',
      finding.summary,
      '',
      '### Remediation',
      '',
      finding.remediation,
      '',
    )
  }
  if (input.coverage.openQuestions.length > 0) {
    lines.push(
      '## Open questions',
      '',
      ...input.coverage.openQuestions.map((question) => `- ${question}`),
      '',
    )
  }
  return `${lines.join('\n')}\n`
}
