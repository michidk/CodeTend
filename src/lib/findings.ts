import { z } from 'zod'

export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const
export type Severity = (typeof SEVERITIES)[number]

export const CONFIDENCES = ['low', 'medium', 'high'] as const
export type Confidence = (typeof CONFIDENCES)[number]

export const EFFORTS = ['trivial', 'small', 'medium', 'large'] as const
export type Effort = (typeof EFFORTS)[number]

export const PRIORITIES = ['low', 'medium', 'high', 'critical'] as const
export type FindingPriority = (typeof PRIORITIES)[number]

export const FINDING_DISPOSITIONS = ['false_positive', 'accepted_risk'] as const
export type FindingDisposition = (typeof FINDING_DISPOSITIONS)[number]

export const VALIDATION_STATUSES = [
  'not_run',
  'confirmed',
  'not_reproduced',
  'inconclusive',
  'unavailable',
  'error',
] as const
export type ValidationStatus = (typeof VALIDATION_STATUSES)[number]

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

export const findingClassificationSchema = z.object({
  cwes: z
    .array(z.string().regex(/^CWE-[1-9][0-9]*$/))
    .max(12)
    .default([])
    .describe('Applicable MITRE CWE identifiers, e.g. "CWE-79". Omit guesses.'),
  owasp: z
    .array(z.string().min(2).max(100))
    .max(8)
    .default([])
    .describe(
      'Applicable OWASP category labels including the framework/year when known, e.g. "A03:2021 Injection".',
    ),
})
export type FindingClassification = z.infer<typeof findingClassificationSchema>

export const securityContextSchema = z.object({
  reachability: z
    .enum(['confirmed', 'likely', 'unknown', 'not-reachable'])
    .default('unknown')
    .describe(
      'Whether a realistic execution path reaches the vulnerable behavior, based only on inspected source evidence.',
    ),
  exposure: z
    .enum(['internet', 'internal', 'local', 'unknown'])
    .default('unknown')
    .describe('The narrowest evidenced attacker exposure of the behavior.'),
  dataSensitivity: z
    .enum(['high', 'standard', 'none', 'unknown'])
    .default('unknown')
    .describe('Sensitivity of data or authority reachable through the issue.'),
})
export type SecurityContext = z.infer<typeof securityContextSchema>

export const codeEvidenceSchema = findingLocationSchema.extend({
  role: z
    .enum(['source', 'control', 'sink', 'supporting', 'test'])
    .describe('How this location supports the vulnerability claim.'),
  excerpt: z
    .string()
    .max(4_000)
    .optional()
    .describe('A short source excerpt when it materially helps review.'),
})
export type CodeEvidence = z.infer<typeof codeEvidenceSchema>

export const attackPathSchema = z.object({
  source: z.string().min(3).max(1_000),
  steps: z.array(z.string().min(1).max(1_000)).min(1).max(20),
  controls: z.array(z.string().min(1).max(1_000)).max(12).default([]),
  sink: z.string().min(3).max(1_000),
  preconditions: z.array(z.string().min(1).max(1_000)).max(12).default([]),
  impact: z.string().min(3).max(2_000),
})
export type AttackPath = z.infer<typeof attackPathSchema>

export const validationCommandSchema = z.object({
  command: z
    .string()
    .min(1)
    .max(2_000)
    .describe(
      'One non-interactive command that does not require network access or credentials.',
    ),
  purpose: z.string().min(3).max(1_000),
  timeoutSeconds: z.number().int().min(1).max(300).default(60),
})
export type ValidationCommand = z.infer<typeof validationCommandSchema>

export const validationPlanSchema = z.object({
  method: z.enum(['build', 'test', 'poc', 'static-check']),
  commands: z.array(validationCommandSchema).min(1).max(4),
  expectedOutcome: z.string().min(3).max(2_000),
  safetyNotes: z.string().max(2_000).default(''),
})
export type ValidationPlan = z.infer<typeof validationPlanSchema>

export interface ValidationCommandResult extends ValidationCommand {
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
  readonly durationMs: number
}

export interface VulnerablePackage {
  readonly ecosystem: string
  readonly name: string
  readonly version: string
  readonly purl: string | null
  readonly cpe: string | null
  readonly manifestPath: string
}

export interface VulnerabilityAdvisory {
  readonly id: string
  readonly url: string | null
}

export interface CvssMetric {
  readonly version: '2.0' | '3.0' | '3.1' | '4.0'
  readonly vector: string
  readonly score: number
  readonly severity: Severity
  readonly source: 'OSV'
}

export interface EpssMetric {
  readonly cve: string
  /** Probability in the inclusive range 0..1. */
  readonly probability: number
  /** Percentile in the inclusive range 0..1. */
  readonly percentile: number
  readonly date: string
}

export interface KevEntry {
  readonly cve: string
  readonly dateAdded: string
  readonly dueDate: string
  readonly requiredAction: string
  readonly knownRansomwareCampaignUse: string
}

export interface VulnerabilityMatch {
  readonly method: 'osv-lockfile-purl' | 'osv-lockfile-package'
  readonly confidence: 'high'
  readonly evidence: readonly string[]
}

/** Authoritative dependency-vulnerability metadata added after agent scanning. */
export interface VulnerabilityMetadata {
  readonly package: VulnerablePackage
  readonly advisories: readonly VulnerabilityAdvisory[]
  readonly match: VulnerabilityMatch
  readonly cvss: readonly CvssMetric[]
  readonly epss: readonly EpssMetric[]
  readonly kev: readonly KevEntry[]
  readonly fixedVersions: readonly string[]
  readonly publishedAt: string | null
  readonly modifiedAt: string | null
  readonly enrichedAt: string
}

export interface FindingEnrichment {
  readonly vulnerability?: VulnerabilityMetadata
  readonly priority?: FindingPriority
  readonly priorityScore?: number
  readonly priorityReasons?: readonly string[]
}

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
  classification: findingClassificationSchema
    .optional()
    .describe(
      'Security classification for source-code security findings. Omit for findings that are not security-related.',
    ),
  securityContext: securityContextSchema
    .optional()
    .describe(
      'Repository-specific exploit context for source-code security findings. Omit outside the Security Hygiene dimension.',
    ),
  rootCause: z
    .string()
    .min(5)
    .max(2_000)
    .optional()
    .describe(
      'The broken security invariant or control at the root of this finding.',
    ),
  codeEvidence: z
    .array(codeEvidenceSchema)
    .max(20)
    .optional()
    .describe('Source-grounded evidence, ordered from entry point to sink.'),
  attackPath: attackPathSchema
    .optional()
    .describe(
      'A realistic attacker-controlled path through controls to the vulnerable sink and impact.',
    ),
  validationPlan: validationPlanSchema
    .optional()
    .describe(
      'A bounded, credential-free plan for reproducing the claim in an isolated environment.',
    ),
  remediationTests: z
    .array(z.string().min(1).max(1_000))
    .max(10)
    .optional()
    .describe('Focused tests that should fail before and pass after a fix.'),
  preventiveControls: z
    .array(z.string().min(1).max(1_000))
    .max(10)
    .optional()
    .describe(
      'Nearby controls that should remain effective after remediation.',
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
export type EnrichedScannerFinding = ScannerFinding & FindingEnrichment

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
  dispositionStillApplies: z
    .boolean()
    .optional()
    .describe(
      'For a hypothesis with a prior manual disposition, whether its recorded reason still applies to the current code and controls.',
    ),
  dispositionAssessment: z
    .string()
    .max(1_000)
    .optional()
    .describe(
      'Evidence for retaining or invalidating a prior false-positive or accepted-risk decision.',
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
  coverage: z
    .object({
      completeness: z.enum(['complete', 'partial', 'unknown']),
      reviewed: z.array(z.string().min(1).max(500)).max(500).default([]),
      deferred: z
        .array(
          z.object({
            path: z.string().min(1).max(500),
            reason: z.string().min(1).max(1_000),
          }),
        )
        .max(200)
        .default([]),
      excluded: z
        .array(
          z.object({
            path: z.string().min(1).max(500),
            reason: z.string().min(1).max(1_000),
          }),
        )
        .max(200)
        .default([]),
      openQuestions: z.array(z.string().min(1).max(1_000)).max(50).default([]),
    })
    .default({
      completeness: 'unknown',
      reviewed: [],
      deferred: [],
      excluded: [],
      openQuestions: [],
    })
    .describe(
      'Honest scan coverage. Never claim complete coverage when relevant surfaces were sampled, skipped, or unavailable.',
    ),
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

export const PRIORITY_ORDER: Record<FindingPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}
