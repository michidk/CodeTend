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
            name: 'CodeTend',
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
  readonly maxInputTokens: number
  readonly target: unknown
  readonly investigation: {
    readonly strategy: string
    readonly confidence: string
    readonly focusAreas: readonly unknown[]
    readonly evidence: readonly unknown[]
    readonly blindSpots: readonly string[]
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
    `- Investigation budget: ${input.maxInputTokens.toLocaleString()} cumulative input tokens`,
    `- Target: \`${JSON.stringify(input.target)}\``,
    `- Investigation confidence: ${input.investigation.confidence}`,
    `- Focus areas: ${input.investigation.focusAreas.length}`,
    `- Evidence records: ${input.investigation.evidence.length}`,
    `- Findings: ${input.findings.length}`,
    '',
  ]
  lines.push('## Investigation strategy', '', input.investigation.strategy, '')
  if (input.investigation.blindSpots.length > 0) {
    lines.push(
      '## Known blind spots',
      '',
      ...input.investigation.blindSpots.map((blindSpot) => `- ${blindSpot}`),
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
  return `${lines.join('\n')}\n`
}
