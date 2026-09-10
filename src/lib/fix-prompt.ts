import type {
  FindingClassification,
  FindingLocation,
  FindingPriority,
  Severity,
  VulnerabilityMetadata,
} from '@/lib/findings'
import { PRIORITY_ORDER, SEVERITY_ORDER } from '@/lib/findings'
import type { ScannerDefinition } from '@/lib/scanners'

export interface FixPromptFinding {
  readonly title: string
  readonly severity: Severity
  readonly confidence: string
  readonly description: string
  readonly whyItMatters: string
  readonly recommendation: string
  readonly effort: string
  readonly locations: readonly FindingLocation[]
  readonly classification?: FindingClassification
  readonly vulnerability?: VulnerabilityMetadata
  readonly priority?: FindingPriority
  readonly priorityScore?: number
  readonly priorityReasons?: readonly string[]
}

export interface FixPromptInput {
  readonly scanner: Pick<
    ScannerDefinition,
    'name' | 'fixPromptTitle' | 'fixGuidance'
  >
  readonly repositoryName: string
  readonly repositoryUrl: string
  readonly branch: string
  readonly commitSha: string | null
  readonly findings: readonly FixPromptFinding[]
}

export function formatLocation(location: FindingLocation): string {
  const range =
    location.startLine !== undefined
      ? location.endLine !== undefined &&
        location.endLine !== location.startLine
        ? `:${location.startLine}-${location.endLine}`
        : `:${location.startLine}`
      : ''
  return `${location.path}${range}${location.symbol ? ` (${location.symbol})` : ''}`
}

/**
 * One aggregated prompt per scanner, ready to paste into Claude Code, Codex or
 * another coding agent. Pure function so the same text is stored with the
 * scanner run and rendered in the UI.
 */
export function buildFixPrompt(input: FixPromptInput): string {
  const sorted = [...input.findings].sort(
    (a, b) =>
      priorityRank(a.priority) - priorityRank(b.priority) ||
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  )
  const lines: string[] = [
    `# ${input.scanner.fixPromptTitle}`,
    '',
    `Repository: ${input.repositoryName} (${input.repositoryUrl}, branch \`${input.branch}\`${
      input.commitSha
        ? `, analyzed at commit \`${input.commitSha.slice(0, 12)}\``
        : ''
    })`,
    '',
    `The findings below come from a full-repository review of **${input.scanner.name}**. They describe root causes, not symptoms. Your task is to fix them in this repository.`,
    '',
    '## How to work',
    '',
    '1. Before changing anything, inspect the repository to confirm each finding against the current code; files may have moved since the scan. Skip a finding only if you can show it no longer applies.',
    '2. Follow the existing conventions of this repository (structure, naming, error handling, testing style, formatting). Do not introduce new frameworks or patterns unless a finding explicitly calls for one.',
    '3. Fix the root cause described in each recommendation rather than papering over symptoms. Where several findings share a cause, address the cause once.',
    '4. Keep changes scoped to the findings. Do not refactor unrelated code.',
    '5. Update or add tests where behavior is touched, run the repository’s existing checks (type checker, linter, tests, build) and fix what they report.',
    '6. Finish with a short summary of what you changed per finding and anything you deliberately left alone, with the reason.',
  ]

  if (input.scanner.fixGuidance) {
    lines.push(
      '',
      `## Handling ${input.scanner.name} findings`,
      '',
      input.scanner.fixGuidance,
    )
  }

  lines.push('', '## Findings')

  if (sorted.length === 0) {
    lines.push('', 'No open findings. Nothing to do for this dimension.')
    return lines.join('\n')
  }

  sorted.forEach((finding, index) => {
    const metadata = findingMetadataLines(finding)
    lines.push(
      '',
      `### ${index + 1}. ${finding.title}`,
      '',
      `- Severity: ${finding.severity} · Confidence: ${finding.confidence} · Estimated effort: ${finding.effort}`,
      ...(finding.priority
        ? [
            `- Priority: ${finding.priority}${finding.priorityScore !== undefined ? ` (${finding.priorityScore}/100)` : ''}${finding.priorityReasons?.length ? ` · ${finding.priorityReasons.join(' · ')}` : ''}`,
          ]
        : []),
      `- Locations: ${finding.locations.map(formatLocation).join(', ')}`,
      ...metadata,
      '',
      `**Problem.** ${finding.description}`,
      '',
      `**Why it matters.** ${finding.whyItMatters}`,
      '',
      `**Recommended fix.** ${finding.recommendation}`,
    )
  })

  return lines.join('\n')
}

function priorityRank(priority: FindingPriority | undefined): number {
  return priority ? PRIORITY_ORDER[priority] : 4
}

function findingMetadataLines(finding: FixPromptFinding): string[] {
  const lines: string[] = []
  const classifications = [
    ...(finding.classification?.cwes ?? []),
    ...(finding.classification?.owasp ?? []),
  ]
  if (classifications.length > 0) {
    lines.push(`- Classification: ${classifications.join(', ')}`)
  }
  const vulnerability = finding.vulnerability
  if (!vulnerability) return lines
  const packageId = `${vulnerability.package.ecosystem}/${vulnerability.package.name}@${vulnerability.package.version}`
  lines.push(
    `- Vulnerable package: ${packageId}${vulnerability.package.purl ? ` · ${vulnerability.package.purl}` : ''}`,
    `- Advisories: ${vulnerability.advisories.map((advisory) => advisory.id).join(', ')}`,
    `- Match: ${vulnerability.match.confidence} confidence via ${vulnerability.match.method} · ${vulnerability.match.evidence.join(' · ')}`,
  )
  if (vulnerability.cvss[0]) {
    const cvss = vulnerability.cvss[0]
    lines.push(
      `- CVSS ${cvss.version}: ${cvss.score.toFixed(1)} · ${cvss.vector}`,
    )
  }
  if (vulnerability.epss[0]) {
    lines.push(
      `- EPSS: ${(vulnerability.epss[0].probability * 100).toFixed(2)}% probability · ${(vulnerability.epss[0].percentile * 100).toFixed(1)}th percentile`,
    )
  }
  if (vulnerability.kev[0]) {
    lines.push(
      `- CISA KEV: added ${vulnerability.kev[0].dateAdded} · remediation due ${vulnerability.kev[0].dueDate}`,
    )
  }
  return lines
}
