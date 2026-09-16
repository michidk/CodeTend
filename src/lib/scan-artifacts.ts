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
