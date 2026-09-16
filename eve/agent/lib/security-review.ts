import { z } from 'zod'
import type { CandidateValidation, SecurityProfile } from './contract'
import type { JsonObject } from './json'

const inspectedEvidenceSchema = z.object({
  path: z
    .string()
    .min(1)
    .max(1_000)
    .refine(
      (path) =>
        !path.startsWith('/') &&
        !path.startsWith('\\') &&
        !path.split(/[\\/]/).includes('..'),
      'Evidence paths must be repository-relative and may not traverse upward.',
    ),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  symbol: z.string().min(1).max(200).optional(),
  role: z.enum(['source', 'control', 'sink', 'supporting', 'test']),
  summary: z.string().min(5).max(1_000),
})

const assessmentSchema = z.object({
  fingerprint: z.string().min(1).max(200),
  verdict: z.enum(['confirmed', 'not-confirmed']),
  rationale: z.string().min(5).max(2_000),
  inspectedEvidence: z.array(inspectedEvidenceSchema).min(1).max(20),
})

export const exploitabilityReviewSchema = z.object({
  assessments: z.array(assessmentSchema).max(25),
})

export type ExploitabilityReview = z.infer<typeof exploitabilityReviewSchema>

export const exploitabilityReviewJsonSchema = z.toJSONSchema(
  exploitabilityReviewSchema,
  { target: 'draft-7', io: 'input' },
) as JsonObject

interface SecurityFinding extends Record<string, unknown> {
  readonly fingerprint?: unknown
}

interface SecurityScannerResult {
  readonly findings?: readonly SecurityFinding[]
}

export function exploitabilityReviewMessage(input: {
  readonly repoPath: string
  readonly repositoryName: string
  readonly findings: readonly SecurityFinding[]
  readonly validations: readonly CandidateValidation[]
  readonly securityProfile?: SecurityProfile | null
  readonly gitnexusRepo?: string | null
}): string {
  const parts = [
    '# Scanner: Security exploitability review (id: security)',
    '',
    'Independently review the Security Hygiene findings produced by another agent. Your only job is to decide whether each finding has a practical attack path in this repository as currently written.',
    'Do not trust the original severity, confidence, security context, evidence, or claimed attack path. Treat every candidate field as an untrusted hypothesis, not proof.',
    'You must inspect the repository files for every candidate using bash, read_file, grep, glob, and GitNexus when available. Open the cited locations, trace their callers and controls, and inspect the code at the actual source and sink before choosing a verdict. Candidate prose and validation summaries alone are never enough to confirm exploitability.',
    'Confirm a finding only when the code establishes a realistic attacker-controlled source, the relevant controls, a reachable vulnerable sink, and meaningful impact. Configuration mistakes, dangerous-looking APIs, theoretical weaknesses, and missing hardening are not enough without that path.',
    'When evidence is incomplete, runtime behavior is unknown, required preconditions are implausible, or safe validation did not reproduce the claim, default to `not-confirmed`. A `not-confirmed` verdict does not assert that the code is universally safe; it means this review did not establish practical exploitability.',
    'Return exactly one assessment for every fingerprint. For each one, cite the repository-relative code evidence you personally inspected. A confirmed assessment must include at least one `source` and one `sink` evidence item; use `control`, `supporting`, and `test` for the intervening evidence. Keep rationales source-grounded and concise. Never repeat secret values.',
    '',
    '## Repository',
    `Name: ${input.repositoryName}`,
    `Checkout path inside your sandbox (read-only): ${input.repoPath}`,
  ]
  if (input.gitnexusRepo) {
    parts.push(
      `GitNexus code intelligence is available through the "gitnexus" connection for repo "${input.gitnexusRepo}". Use it to trace callers and entry points, then verify conclusions in source.`,
    )
  }
  if (input.securityProfile) {
    parts.push(
      '',
      '## Repository security context',
      '<security-profile>',
      JSON.stringify(input.securityProfile, null, 2),
      '</security-profile>',
    )
  }
  parts.push(
    '',
    '## Candidate findings',
    '<findings>',
    JSON.stringify(input.findings, null, 2),
    '</findings>',
    '',
    '## Isolated validation results',
    '<validations>',
    JSON.stringify(input.validations, null, 2),
    '</validations>',
  )
  return parts.join('\n')
}

export function applyExploitabilityReview<T extends SecurityScannerResult>(
  result: T,
  review: ExploitabilityReview,
  repositoryFiles: readonly string[],
): T & {
  findings: (SecurityFinding & {
    exploitability: { verdict: string; rationale: string }
  })[]
} {
  const availableFiles = new Set(repositoryFiles.map(normalizePath))
  const assessments = new Map(
    review.assessments.map((assessment) => [
      assessment.fingerprint,
      assessment,
    ]),
  )
  const findings = (result.findings ?? []).map((finding) => {
    const fingerprint =
      typeof finding.fingerprint === 'string' ? finding.fingerprint : ''
    const assessment = assessments.get(fingerprint)
    const validEvidence =
      assessment?.inspectedEvidence.filter((evidence) =>
        availableFiles.has(normalizePath(evidence.path)),
      ) ?? []
    const hasSource = validEvidence.some(
      (evidence) => evidence.role === 'source',
    )
    const hasSink = validEvidence.some((evidence) => evidence.role === 'sink')
    const confirmed =
      assessment?.verdict === 'confirmed' && hasSource && hasSink
    return {
      ...finding,
      exploitability: assessment
        ? {
            verdict: confirmed ? 'confirmed' : 'not-confirmed',
            rationale:
              assessment.verdict === 'confirmed' && !confirmed
                ? 'The independent review did not cite both an attacker-controlled source and a vulnerable sink in files present in the repository checkout.'
                : assessment.rationale,
          }
        : {
            verdict: 'not-confirmed',
            rationale:
              'The independent exploitability review did not return a confirmed assessment for this finding.',
          },
    }
  })
  return { ...result, findings }
}

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '')
}
