import type { FindingLocation, Severity } from '@/lib/findings'
import { SEVERITY_ORDER } from '@/lib/findings'
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
}

export interface FixPromptInput {
  readonly scanner: Pick<ScannerDefinition, 'name' | 'fixPromptTitle'>
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
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
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
    '',
    '## Findings',
  ]

  if (sorted.length === 0) {
    lines.push('', 'No open findings. Nothing to do for this dimension.')
    return lines.join('\n')
  }

  sorted.forEach((finding, index) => {
    lines.push(
      '',
      `### ${index + 1}. ${finding.title}`,
      '',
      `- Severity: ${finding.severity} · Confidence: ${finding.confidence} · Estimated effort: ${finding.effort}`,
      `- Locations: ${finding.locations.map(formatLocation).join(', ')}`,
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
