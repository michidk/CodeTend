import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { artifactSha256, toSarifDocument } from './scan-artifacts'

describe('portable scan artifacts', () => {
  test('hashes exact serialized bytes', () => {
    const contents = '{"schemaVersion":"1"}\n'
    expect(artifactSha256(contents)).toBe(
      createHash('sha256').update(contents).digest('hex'),
    )
    expect(artifactSha256(`${contents} `)).not.toBe(artifactSha256(contents))
  })

  test('emits SARIF 2.1.0 with revision, severity, location, and fingerprint', () => {
    const sarif = toSarifDocument(
      'https://github.com/acme/service',
      'a'.repeat(40),
      [
        {
          ruleId: 'security:unsafe-redirect',
          fingerprint: 'unsafe-redirect-handler',
          title: 'Unvalidated redirect',
          summary: 'User input reaches a redirect sink.',
          severity: 'high',
          locations: [{ path: 'src/auth.ts', startLine: 42 }],
        },
      ],
    )
    expect(sarif.version).toBe('2.1.0')
    expect(sarif.runs[0]?.versionControlProvenance[0]?.revisionId).toBe(
      'a'.repeat(40),
    )
    expect(sarif.runs[0]?.results[0]).toMatchObject({
      ruleId: 'security:unsafe-redirect',
      level: 'error',
      partialFingerprints: {
        primaryLocationLineHash: 'unsafe-redirect-handler',
      },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: 'src/auth.ts' },
            region: { startLine: 42 },
          },
        },
      ],
    })
  })
})
