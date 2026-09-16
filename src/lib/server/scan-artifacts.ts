import '@tanstack/react-start/server-only'

import { eq } from 'drizzle-orm'
import { db } from '@/db'
import {
  findingOccurrences,
  findingValidations,
  scanArtifacts,
  scans,
} from '@/db/schema'
import { artifactSha256, toSarifDocument } from '@/lib/scan-artifacts'
import type {
  ScanCoverage,
  ScanManifest,
  ScanReport,
} from '@/lib/security-scans'

type ArtifactKind =
  | 'manifest'
  | 'findings'
  | 'coverage'
  | 'investigation'
  | 'report'
  | 'sarif'

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
    documentType: 'codetend.findings',
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
      subject: occurrence.subject ?? occurrence.finding.subject,
      evidence: occurrence.evidence,
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
  const investigation = scan.investigation ?? {
    strategy: 'This legacy scan did not produce an investigation report.',
    focusAreas: [],
    evidence: [],
    blindSpots: ['Investigation history is unavailable for this scan.'],
    confidence: 'low' as const,
  }
  const coverage: ScanCoverage = scan.coverage ?? {
    completeness: 'unknown',
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
  const report: ScanReport = {
    documentType: 'codetend.scan-report',
    schemaVersion: '1',
    generatedAt: new Date().toISOString(),
    scan: {
      id: scan.id,
      repositoryId: scan.repositoryId,
      repositoryName: scan.repository.name,
      repositoryUrl: scan.repository.url,
      revision: scan.commitSha,
      target: scan.target,
      mode: scan.mode,
      maxInputTokens: scan.maxInputTokens,
      model: scan.model,
      status: scan.status,
    },
    summary: {
      overallScore: scan.overallScore,
      grade: scan.grade,
      findingCount: findingDocument.findings.length,
      findingCounts: scan.counts,
    },
    coverage,
    investigation,
    findings: findingDocument.findings.map((finding) => ({
      findingId: finding.findingId,
      occurrenceId: finding.occurrenceId,
      ruleId: finding.ruleId,
      fingerprint: finding.fingerprint,
      state: finding.state,
      title: finding.title,
      summary: finding.summary,
      severity: finding.severity,
      confidence: finding.confidence,
      priority: finding.priority,
      locations: finding.locations,
      remediation: finding.remediation,
    })),
  }
  const baseArtifacts: Artifact[] = [
    jsonArtifact('findings', findingDocument),
    jsonArtifact('coverage', coverage),
    jsonArtifact('investigation', investigation),
    jsonArtifact('sarif', sarif, 'application/sarif+json'),
    jsonArtifact('report', report),
  ]
  const artifactHashes = Object.fromEntries(
    baseArtifacts.map((artifact) => [
      artifact.kind,
      artifactSha256(artifact.contents),
    ]),
  )
  const manifest: ScanManifest = {
    schemaVersion: '2',
    scanId,
    repositoryId: scan.repositoryId,
    repositoryUrl: scan.repository.url,
    revision: scan.commitSha,
    target: scan.target,
    mode: scan.mode,
    maxInputTokens: scan.maxInputTokens,
    model: scan.model,
    scannerVersions: { contract: '2' },
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
    await tx.update(scans).set({ manifest, report }).where(eq(scans.id, scanId))
  })
}

export async function getScanArtifact(scanId: number, kind: ArtifactKind) {
  return db.query.scanArtifacts.findFirst({
    where: (table, { and, eq }) =>
      and(eq(table.scanId, scanId), eq(table.kind, kind)),
  })
}

function jsonArtifact(
  kind: ArtifactKind,
  value: unknown,
  contentType = 'application/json; charset=utf-8',
): Artifact {
  return { kind, contentType, contents: `${JSON.stringify(value, null, 2)}\n` }
}
