import { z } from 'zod'
import { scannerSecurityReview } from '@/lib/scanners'
import type {
  CandidateValidation,
  ScannerOutcome,
  ScanRequestScanner,
  SecurityProfile,
} from './contract'
import type { JsonObject } from './json'
import {
  confirmReviewEvidence,
  inspectedEvidenceSchema,
} from './security-review-evidence'

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
  readonly scannerId?: string
  readonly securityReview?: 'application' | 'ci'
  readonly repoPath: string
  readonly repositoryName: string
  readonly findings: readonly SecurityFinding[]
  readonly validations: readonly CandidateValidation[]
  readonly securityProfile?: SecurityProfile | null
  readonly gitnexusRepo?: string | null
}): string {
  const parts = [
    `# Scanner: Security exploitability review (id: ${input.scannerId ?? 'security'})`,
    '',
    'Independently review the security findings produced by another agent. Your only job is to decide whether each finding has a practical attack path in this repository as currently written.',
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
  if (input.securityReview === 'ci') {
    parts.push(
      'For CI findings, inspect workflow triggers, reusable/local actions and called scripts. Trace the external actor or lower-trust producer (source) through gates, checkout refs, artifacts and permissions to privileged execution, credential exposure or release (sink). Configuration evidence in workflow files is valid source/sink evidence. Do not infer effective repository settings; identify unknown settings and do not confirm a path that depends on an unestablished privilege. A mutable reference alone is not proof of an exploitable path.',
    )
  }
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
    const { confirmed: evidenceConfirmed } = confirmReviewEvidence(
      assessment?.inspectedEvidence ?? [],
      repositoryFiles,
    )
    const confirmed = assessment?.verdict === 'confirmed' && evidenceConfirmed
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

/** Validation and review use the same scanner capability, including legacy requests. */
export function securityValidationCandidates(
  outcomes: readonly ScannerOutcome[],
  scanners: readonly ScanRequestScanner[],
) {
  return outcomes.flatMap((outcome) => {
    const scanner = scanners.find((scanner) => scanner.id === outcome.scannerId)
    if (
      outcome.status !== 'completed' ||
      !outcome.result ||
      !scanner ||
      !scannerSecurityReview(scanner)
    )
      return []
    return outcome.result.findings
      .map((finding) => ({
        scannerId: outcome.scannerId,
        fingerprint: finding.fingerprint,
        validationPlan: finding.validationPlan,
      }))
      .filter((candidate) => candidate.fingerprint.length > 0)
  })
}
