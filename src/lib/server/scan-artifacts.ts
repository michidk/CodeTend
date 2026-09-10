import '@tanstack/react-start/server-only'

import { eq } from 'drizzle-orm'
import { db } from '@/db'
import {
  findingOccurrences,
  findingValidations,
  scanArtifacts,
  scans,
} from '@/db/schema'
import {
  artifactSha256,
  toMarkdownScanReport,
  toSarifDocument,
} from '@/lib/scan-artifacts'
import type { ScanManifest } from '@/lib/security-scans'

type ArtifactKind = 'manifest' | 'findings' | 'coverage' | 'report' | 'sarif'

interface Artifact {
  readonly kind: ArtifactKind
  readonly contentType: string
  readonly contents: string
}

/** Builds and seals the portable artifact bundle for one persisted scan. */
export async function sealScanArtifacts(scanId: number): Promise<void> {
  const scan = await db.query.scans.findFirst({
    where: eq(scans.id, scanId),
    with: { repository: true },
  })
  if (!scan?.commitSha) return
  const occurrences = await db.query.findingOccurrences.findMany({
    where: eq(findingOccurrences.scanId, scanId),
    with: { finding: true },
  })
  const validations = await db
    .select()
    .from(findingValidations)
    .innerJoin(
      findingOccurrences,
      eq(findingValidations.occurrenceId, findingOccurrences.id),
    )
    .where(eq(findingOccurrences.scanId, scanId))
  const validationByFinding = new Map(
    validations.map((row) => [
      row.finding_validations.findingId,
      row.finding_validations,
    ]),
  )

  const findingDocument = {
    documentType: 'tecdebt.findings',
    schemaVersion: '1',
    scanId,
    findings: occurrences.map((occurrence) => ({
      findingId: occurrence.findingId,
      occurrenceId: occurrence.id,
      ruleId: `${occurrence.finding.scannerId}:${occurrence.finding.fingerprint}`,
      fingerprint: occurrence.finding.fingerprint,
      state: occurrence.state,
      title: occurrence.finding.title,
      summary: occurrence.finding.description,
      severity: occurrence.severity,
      confidence: occurrence.confidence,
      priority: occurrence.priority,
      taxonomy: occurrence.classification,
      locations: occurrence.finding.locations,
      rootCause: occurrence.rootCause,
      codeEvidence: occurrence.codeEvidence,
      attackPath: occurrence.attackPath,
      validation: validationByFinding.get(occurrence.findingId) ?? null,
      remediation: occurrence.finding.recommendation,
      remediationTests: occurrence.finding.remediationTests,
      preventiveControls: occurrence.finding.preventiveControls,
      vulnerability: occurrence.vulnerability,
    })),
  }
  const coverage = scan.coverage ?? {
    completeness: 'unknown' as const,
    reviewed: [],
    deferred: [],
    excluded: [],
    openQuestions: ['This scan did not produce structured coverage.'],
  }
  const sarif = toSarifDocument(
    scan.repository.url,
    scan.commitSha,
    findingDocument.findings,
  )
  const report = toMarkdownScanReport({
    repository: scan.repository.name,
    revision: scan.commitSha,
    mode: scan.mode,
    target: scan.target,
    coverage,
    findings: findingDocument.findings,
  })
  const baseArtifacts: Artifact[] = [
    jsonArtifact('findings', findingDocument),
    jsonArtifact('coverage', coverage),
    jsonArtifact('sarif', sarif, 'application/sarif+json'),
    {
      kind: 'report',
      contentType: 'text/markdown; charset=utf-8',
      contents: report,
    },
  ]
  const artifactHashes = Object.fromEntries(
    baseArtifacts.map((artifact) => [
      artifact.kind,
      artifactSha256(artifact.contents),
    ]),
  )
  const manifest: ScanManifest = {
    schemaVersion: '1',
    scanId,
    repositoryId: scan.repositoryId,
    repositoryUrl: scan.repository.url,
    revision: scan.commitSha,
    target: scan.target,
    mode: scan.mode,
    model: scan.model,
    scannerVersions: { contract: '1' },
    artifactHashes,
    createdAt: new Date().toISOString(),
  }
  const artifacts = [jsonArtifact('manifest', manifest), ...baseArtifacts]
  await db.transaction(async (tx) => {
    for (const artifact of artifacts) {
      await tx
        .insert(scanArtifacts)
        .values({
          scanId,
          kind: artifact.kind,
          contentType: artifact.contentType,
          sha256: artifactSha256(artifact.contents),
          contents: artifact.contents,
        })
        .onConflictDoUpdate({
          target: [scanArtifacts.scanId, scanArtifacts.kind],
          set: {
            contentType: artifact.contentType,
            sha256: artifactSha256(artifact.contents),
            contents: artifact.contents,
          },
        })
    }
    await tx.update(scans).set({ manifest }).where(eq(scans.id, scanId))
  })
}

export async function getScanArtifact(scanId: number, kind: ArtifactKind) {
  return db.query.scanArtifacts.findFirst({
    where: (table, { and, eq }) =>
      and(eq(table.scanId, scanId), eq(table.kind, kind)),
  })
}

function jsonArtifact(
  kind: Exclude<ArtifactKind, 'report'>,
  value: unknown,
  contentType = 'application/json; charset=utf-8',
): Artifact {
  return { kind, contentType, contents: `${JSON.stringify(value, null, 2)}\n` }
}
