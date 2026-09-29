import type { Confidence, Severity } from '@/lib/findings'
import {
  getScanner,
  type ScannerDefinition,
  scannerSecurityReview,
} from '@/lib/scanners'

/**
 * Deterministic scoring. Every scanner starts at 100 and loses a penalty per
 * open finding, scaled by confidence. The LLM never proposes numbers.
 */
export const SEVERITY_PENALTY: Record<Severity, number> = {
  low: 3,
  medium: 8,
  high: 16,
  critical: 30,
}

export const CONFIDENCE_FACTOR: Record<Confidence, number> = {
  low: 0.5,
  medium: 0.8,
  high: 1,
}

export const GRADES = ['A', 'B', 'C', 'D', 'F'] as const
export type Grade = (typeof GRADES)[number]

const GRADE_THRESHOLDS: readonly {
  readonly min: number
  readonly grade: Grade
}[] = [
  { min: 90, grade: 'A' },
  { min: 75, grade: 'B' },
  { min: 60, grade: 'C' },
  { min: 40, grade: 'D' },
  { min: 0, grade: 'F' },
]

export interface ScorableFinding {
  readonly severity: Severity
  readonly confidence: Confidence
  readonly exploitability?: { readonly verdict: string }
}

export function findingPenalty(finding: ScorableFinding): number {
  return (
    SEVERITY_PENALTY[finding.severity] * CONFIDENCE_FACTOR[finding.confidence]
  )
}

export function calculateScannerScore(
  findings: readonly ScorableFinding[],
): number {
  const penalty = findings.reduce(
    (total, finding) => total + findingPenalty(finding),
    0,
  )
  return Math.max(0, Math.round((100 - penalty) * 10) / 10)
}

export interface ScannerScoreInput {
  readonly scanner: Pick<
    ScannerDefinition,
    'id' | 'weight' | 'kind' | 'securityReview'
  >
  readonly score: number | null
  readonly findings?: readonly ScorableFinding[]
}

/** Weighted mean, capped at F for a high-confidence critical open finding.
 * Unconfirmed security hypotheses do not trigger the cap. */
export function calculateOverallScore(
  scores: readonly ScannerScoreInput[],
): number | null {
  const scored = scores.filter(
    (entry): entry is ScannerScoreInput & { score: number } =>
      entry.score !== null,
  )
  if (scored.length === 0) return null
  const totalWeight = scored.reduce(
    (total, entry) => total + entry.scanner.weight,
    0,
  )
  const weighted = scored.reduce(
    (total, entry) => total + entry.score * entry.scanner.weight,
    0,
  )
  const average = Math.round((weighted / totalWeight) * 10) / 10
  const hasCritical = scored.some((entry) =>
    entry.findings?.some(
      (finding) =>
        finding.severity === 'critical' &&
        finding.confidence === 'high' &&
        (scannerSecurityReview(entry.scanner) ||
        (entry.scanner.kind ?? getScanner(entry.scanner.id)?.kind) ===
          'dependency-audit'
          ? finding.exploitability?.verdict === 'confirmed'
          : finding.exploitability?.verdict !== 'not-confirmed'),
    ),
  )
  return hasCritical ? Math.min(39, average) : average
}

export function gradeForScore(score: number | null): Grade | null {
  if (score === null) return null
  return (
    GRADE_THRESHOLDS.find((threshold) => score >= threshold.min)?.grade ?? 'F'
  )
}

export const GRADE_DESCRIPTIONS: Record<Grade, string> = {
  A: 'Low aggregate debt in the areas investigated.',
  B: 'Limited aggregate debt in the areas investigated.',
  C: 'Fair: noticeable debt that slows changes down.',
  D: 'Poor: significant debt across several dimensions.',
  F: 'Critical finding or substantial aggregate debt; inspect the findings.',
}
