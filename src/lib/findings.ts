import { z } from 'zod'

export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const
export type Severity = (typeof SEVERITIES)[number]

export const CONFIDENCES = ['low', 'medium', 'high'] as const
export type Confidence = (typeof CONFIDENCES)[number]

export const EFFORTS = ['trivial', 'small', 'medium', 'large'] as const
export type Effort = (typeof EFFORTS)[number]

export const FINDING_STATES = [
  'new',
  'active',
  'improved',
  'resolved',
  'regressed',
] as const
export type FindingState = (typeof FINDING_STATES)[number]

/** Finding states that count as still present in the repository. */
export const OPEN_FINDING_STATES: readonly FindingState[] = [
  'new',
  'active',
  'improved',
  'regressed',
]

export const findingLocationSchema = z.object({
  path: z.string().min(1).max(500),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  symbol: z.string().max(200).optional(),
})
export type FindingLocation = z.infer<typeof findingLocationSchema>

/**
 * The structured finding every scanner returns. The `fingerprint` is a short,
 * stable, human-chosen identifier for the *logical* problem (not its exact
 * location), so a rescan can recognize the same issue even after files moved.
 */
export const scannerFindingSchema = z.object({
  fingerprint: z
    .string()
    .min(3)
    .max(120)
    .describe(
      'Stable kebab-case identifier for the logical problem, e.g. "duplicated-price-validation-across-cart-and-checkout". Must not include line numbers.',
    ),
  title: z.string().min(3).max(200),
  severity: z.enum(SEVERITIES),
  confidence: z.enum(CONFIDENCES),
  description: z.string().min(10).max(4000),
  whyItMatters: z.string().min(5).max(2000),
  recommendation: z.string().min(5).max(3000),
  effort: z.enum(EFFORTS),
  locations: z.array(findingLocationSchema).min(1).max(12),
  /** Verification result when the finding was given back as a hypothesis. */
  previousFindingId: z.number().int().positive().nullable().optional(),
})
export type ScannerFinding = z.infer<typeof scannerFindingSchema>

/**
 * Verdict for a previous finding the scanner was asked to re-verify.
 * `resolved` means the problem is gone; `improved` means partially fixed but
 * still present (the scanner also returns an updated finding in that case).
 */
export const hypothesisVerdictSchema = z.object({
  previousFindingId: z.number().int().positive(),
  verdict: z.enum(['confirmed', 'improved', 'resolved']),
  note: z.string().max(1000).optional(),
})

export const scannerResultSchema = z.object({
  summary: z
    .string()
    .max(3000)
    .describe(
      'Two to five sentences describing the overall health of the repository for this scanner dimension.',
    ),
  findings: z.array(scannerFindingSchema).max(25),
  hypothesisVerdicts: z.array(hypothesisVerdictSchema).default([]),
})
export type ScannerResult = z.infer<typeof scannerResultSchema>

/** JSON Schema handed to Eve as the subagent output schema. */
export const scannerResultJsonSchema = z.toJSONSchema(scannerResultSchema, {
  target: 'draft-7',
  io: 'input',
})

export const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}
