import type { Confidence, Severity } from '@/lib/findings'
import type { ScannerDefinition } from '@/lib/scanners'

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
  readonly scanner: Pick<ScannerDefinition, 'id' | 'weight'>
  readonly score: number | null
}

/** Weighted mean of the scanner scores that actually produced a result. */
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
  return Math.round((weighted / totalWeight) * 10) / 10
}

export function gradeForScore(score: number | null): Grade | null {
  if (score === null) return null
  return (
    GRADE_THRESHOLDS.find((threshold) => score >= threshold.min)?.grade ?? 'F'
  )
}

export const GRADE_DESCRIPTIONS: Record<Grade, string> = {
  A: 'Healthy: little technical debt worth acting on.',
  B: 'Good: a handful of issues, none urgent.',
  C: 'Fair: noticeable debt that slows changes down.',
  D: 'Poor: significant debt across several dimensions.',
  F: 'Critical: the codebase actively resists change.',
}
