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
  path: z
    .string()
    .min(1)
    .max(500)
    .describe(
      'Path relative to the repository root, e.g. "src/auth/session.rs". Never a sandbox or absolute path.',
    ),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  symbol: z
    .string()
    .max(200)
    .optional()
    .describe('Function, class, type or module name at this location.'),
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
  title: z
    .string()
    .min(3)
    .max(200)
    .describe(
      'One specific sentence fragment naming the problem and where it lives. No file paths, no severity words, no trailing period.',
    ),
  severity: z
    .enum(SEVERITIES)
    .describe(
      'critical: defects, data loss, security exposure or outages today; high: significant and growing cost; medium: real but bounded cost; low: minor.',
    ),
  confidence: z
    .enum(CONFIDENCES)
    .describe(
      'high: every cited location was read and confirms the problem; medium: solid but partly inferred; low: suspected from indirect signs.',
    ),
  description: z
    .string()
    .min(10)
    .max(4000)
    .describe(
      'The problem and the evidence for it: files, symbols and patterns, what each does and where they conflict. Understandable without opening the repository.',
    ),
  whyItMatters: z
    .string()
    .min(5)
    .max(2000)
    .describe(
      'The concrete cost or risk for this repository: which changes it slows, which failure it can cause, who observes it.',
    ),
  recommendation: z
    .string()
    .min(5)
    .max(3000)
    .describe(
      'The root-cause fix as a target state a coding agent could implement, following the repository conventions. One decisive recommendation.',
    ),
  effort: z
    .enum(EFFORTS)
    .describe(
      'trivial: minutes, one place; small: an hour or two, a few files; medium: a day or two, one subsystem; large: multi-day or cross-cutting.',
    ),
  locations: z
    .array(findingLocationSchema)
    .min(1)
    .max(12)
    .describe(
      'Inspected locations only, primary location first, repository-relative paths.',
    ),
  /** Verification result when the finding was given back as a hypothesis. */
  previousFindingId: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe(
      'Set to the hypothesis findingId when this finding confirms or updates a hypothesis; omit for new findings.',
    ),
})
export type ScannerFinding = z.infer<typeof scannerFindingSchema>

/**
 * Verdict for a previous finding the scanner was asked to re-verify.
 * `resolved` means the problem is gone; `improved` means partially fixed but
 * still present (the scanner also returns an updated finding in that case).
 */
export const hypothesisVerdictSchema = z.object({
  previousFindingId: z.number().int().positive(),
  verdict: z
    .enum(['confirmed', 'improved', 'resolved'])
    .describe(
      'confirmed: still exists as described; improved: partially addressed but present; resolved: gone from the current code.',
    ),
  note: z
    .string()
    .max(1000)
    .optional()
    .describe(
      'What you checked and, for resolved or improved, what changed in the code.',
    ),
})

export const scannerResultSchema = z.object({
  summary: z
    .string()
    .max(3000)
    .describe(
      'Two to five sentences of plain prose: what was inspected, what is healthy and what the main problems are for this dimension. No markup.',
    ),
  findings: z
    .array(scannerFindingSchema)
    .max(25)
    .describe(
      'Distinct root-cause problems in this dimension only; empty when the dimension is healthy.',
    ),
  hypothesisVerdicts: z
    .array(hypothesisVerdictSchema)
    .default([])
    .describe('Exactly one verdict per hypothesis listed in the task.'),
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
