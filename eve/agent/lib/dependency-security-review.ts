import { z } from 'zod'
import type { DependencyAuditResult, SecurityProfile } from './contract'
import type { JsonObject } from './json'
import {
  confirmReviewEvidence,
  inspectedEvidenceSchema,
} from './security-review-evidence'

const REVIEW_BATCH_SIZE = 25

const osvVulnerabilitySchema = z.object({
  id: z.string(),
  aliases: z.array(z.string()).optional(),
  summary: z.string().optional(),
  details: z.string().optional(),
})

const osvReviewReportSchema = z.object({
  results: z
    .array(
      z.object({
        packages: z.array(
          z.object({
            package: z.object({
              ecosystem: z.string(),
              name: z.string(),
              version: z.string(),
            }),
            groups: z
              .array(
                z.object({
                  ids: z.array(z.string()),
                  aliases: z.array(z.string()).optional(),
                }),
              )
              .optional(),
            vulnerabilities: z.array(osvVulnerabilitySchema),
          }),
        ),
      }),
    )
    .nullable()
    .default([])
    .transform((results) => results ?? []),
})

const reviewAssessmentSchema = z.object({
  candidateId: z.string().min(1).max(100),
  verdict: z.enum(['confirmed', 'not-confirmed']),
  rationale: z.string().min(5).max(2_000),
  inspectedEvidence: z.array(inspectedEvidenceSchema).min(1).max(20),
})

export const dependencyImpactReviewSchema = z.object({
  assessments: z.array(reviewAssessmentSchema).max(REVIEW_BATCH_SIZE),
})

export const dependencyImpactReviewJsonSchema = z.toJSONSchema(
  dependencyImpactReviewSchema,
  { target: 'draft-7', io: 'input' },
) as JsonObject

export type DependencyImpactReview = z.infer<
  typeof dependencyImpactReviewSchema
>

export interface DependencyImpactCandidate {
  readonly id: string
  readonly package: {
    readonly ecosystem: string
    readonly name: string
    readonly version: string
  }
  readonly advisoryIds: readonly string[]
  readonly summary: string
  readonly details: string
}

type DependencyImpactAssessment = NonNullable<
  DependencyAuditResult['exploitabilityAssessments']
>[number]

export function dependencyImpactCandidates(
  report: unknown,
): DependencyImpactCandidate[] {
  const parsed = osvReviewReportSchema.parse(report)
  const candidates = new Map<string, Omit<DependencyImpactCandidate, 'id'>>()

  for (const result of parsed.results) {
    for (const entry of result.packages) {
      const groups =
        entry.groups && entry.groups.length > 0
          ? entry.groups
          : entry.vulnerabilities.map((vulnerability) => ({
              ids: [vulnerability.id],
              aliases: vulnerability.aliases,
            }))
      for (const group of groups) {
        const advisoryIds = uniqueStrings([
          ...group.ids,
          ...(group.aliases ?? []),
        ])
        const vulnerabilities = entry.vulnerabilities.filter((vulnerability) =>
          [vulnerability.id, ...(vulnerability.aliases ?? [])].some((id) =>
            advisoryIds.includes(id),
          ),
        )
        const allAdvisoryIds = uniqueStrings([
          ...advisoryIds,
          ...vulnerabilities.flatMap((vulnerability) => [
            vulnerability.id,
            ...(vulnerability.aliases ?? []),
          ]),
        ])
        const key = candidateKey(entry.package, allAdvisoryIds)
        candidates.set(key, {
          package: entry.package,
          advisoryIds: allAdvisoryIds,
          summary:
            vulnerabilities.find((vulnerability) => vulnerability.summary)
              ?.summary ?? 'OSV reports a vulnerability for this package.',
          details: vulnerabilities
            .map((vulnerability) => vulnerability.details)
            .filter((details): details is string => Boolean(details))
            .join('\n\n')
            .slice(0, 4_000),
        })
      }
    }
  }

  return [...candidates.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, candidate], index) => ({
      id: `dependency-${index + 1}`,
      ...candidate,
    }))
}

export function dependencyImpactReviewBatches(
  candidates: readonly DependencyImpactCandidate[],
): DependencyImpactCandidate[][] {
  const batches: DependencyImpactCandidate[][] = []
  for (let start = 0; start < candidates.length; start += REVIEW_BATCH_SIZE) {
    batches.push(candidates.slice(start, start + REVIEW_BATCH_SIZE))
  }
  return batches
}

export function dependencyImpactReviewMessage(input: {
  readonly repoPath: string
  readonly repositoryName: string
  readonly candidates: readonly DependencyImpactCandidate[]
  readonly securityProfile?: SecurityProfile | null
  readonly gitnexusRepo?: string | null
}): string {
  const parts = [
    '# Scanner: Dependency vulnerability impact review (id: vulnerabilities)',
    '',
    'Independently determine the actual impact of every OSV candidate in this repository as currently written and deployed. The advisory match and published severity are facts about the installed package version, but they do not prove that this repository exposes the vulnerable behavior.',
    'You must inspect repository manifests, lockfiles, imports, call sites, build and deployment configuration, and the vulnerable behavior described by the advisory. Use bash, read_file, grep, glob, and GitNexus when available. Do not decide from package names, dependency/devDependency labels, CVSS, or candidate prose alone.',
    'Confirm only when repository evidence establishes a realistic attacker-controlled source, the relevant controls and preconditions, a reachable use of the affected package behavior, and meaningful impact in the deployed application or an exposed build/deployment boundary. Trusted author-only build, test, lint, or local tooling paths are not practical attack paths by themselves.',
    'When the affected API or behavior is unused, only runs during trusted builds/tests, requires implausible preconditions, or cannot be traced from an attacker-controlled source, return `not-confirmed`. This means the review did not establish practical exploitability; it does not dispute the advisory or claim universal safety.',
    'Return exactly one assessment for every candidateId. Cite repository-relative files you personally inspected. A confirmed assessment must include at least one `source` and one `sink` evidence item. For not-confirmed findings, cite the manifest, dependency path, build configuration, or searched call sites that support the conclusion. Never repeat secret values.',
    '',
    '## Repository',
    `Name: ${input.repositoryName}`,
    `Checkout path inside your sandbox (read-only): ${input.repoPath}`,
  ]
  if (input.gitnexusRepo) {
    parts.push(
      `GitNexus code intelligence is available through the "gitnexus" connection for repo "${input.gitnexusRepo}". Use it to trace package call sites and entry points, then verify conclusions in source.`,
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
    '## Dependency candidates',
    '<candidates>',
    JSON.stringify(input.candidates, null, 2),
    '</candidates>',
  )
  return parts.join('\n')
}

export function applyDependencyImpactReviews(
  candidates: readonly DependencyImpactCandidate[],
  reviews: readonly DependencyImpactReview[],
  repositoryFiles: readonly string[],
): DependencyImpactAssessment[] {
  const reviewed = new Map(
    reviews.flatMap((review) =>
      review.assessments.map((assessment) => [
        assessment.candidateId,
        assessment,
      ]),
    ),
  )

  return candidates.map((candidate) => {
    const assessment = reviewed.get(candidate.id)
    const { confirmed: evidenceConfirmed, validEvidence } =
      confirmReviewEvidence(
        assessment?.inspectedEvidence ?? [],
        repositoryFiles,
      )
    const confirmed = assessment?.verdict === 'confirmed' && evidenceConfirmed

    return {
      package: candidate.package,
      advisoryIds: [...candidate.advisoryIds],
      verdict: confirmed ? 'confirmed' : 'not-confirmed',
      rationale: assessment
        ? assessment.verdict === 'confirmed' && !confirmed
          ? 'The independent review did not cite both an attacker-controlled source and a vulnerable dependency sink in files present in the repository checkout.'
          : assessment.rationale
        : 'The independent dependency impact review did not return a confirmed assessment for this candidate.',
      inspectedEvidence: validEvidence,
    }
  })
}

function candidateKey(
  pkg: DependencyImpactCandidate['package'],
  advisoryIds: readonly string[],
): string {
  return [pkg.ecosystem, pkg.name, pkg.version, ...advisoryIds].join('\0')
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((left, right) =>
    left.localeCompare(right),
  )
}
