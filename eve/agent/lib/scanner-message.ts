import type {
  KnowledgeResult,
  ScanRequestScanner,
  WorkspaceManifest,
} from './contract'

const MAX_KNOWLEDGE_CHARS = 14_000

export function scannerAgentMessage(input: {
  scanner: ScanRequestScanner
  repoPath: string
  repositoryName: string
  workspace: WorkspaceManifest
  knowledge: KnowledgeResult
  gitnexusRepo: string | null
}): string {
  const { scanner, workspace, knowledge } = input
  const overview =
    knowledge.overview.length > MAX_KNOWLEDGE_CHARS
      ? `${knowledge.overview.slice(0, MAX_KNOWLEDGE_CHARS)}\n\n[overview truncated]`
      : knowledge.overview

  const parts: string[] = [
    `# Scanner: ${scanner.name} (id: ${scanner.id})`,
    '',
    '## Dimension to review',
    scanner.prompt,
    '',
    '## Repository',
    `Name: ${input.repositoryName}`,
    `Checkout path inside your sandbox (read-only): ${input.repoPath}`,
    `Commit: ${workspace.commitSha}`,
    `Tracked files: ${workspace.fileCount}`,
    `Top-level entries: ${workspace.topLevel.join(', ')}`,
    `Languages: ${knowledge.summary.languages.join(', ') || 'unknown — infer them'}`,
    `Frameworks: ${knowledge.summary.frameworks.join(', ') || 'unknown — infer them'}`,
  ]

  if (input.gitnexusRepo) {
    parts.push(
      '',
      `GitNexus code intelligence is available through the "gitnexus" connection for repo "${input.gitnexusRepo}" (always pass repo: "${input.gitnexusRepo}"). Useful tools: query (semantic/keyword search over symbols and execution flows), context (callers/callees of a symbol), impact (blast radius), check (import cycles), trace (paths between symbols). It is an accelerator only; the files are the ground truth and languages GitNexus does not parse must still be analyzed directly.`,
    )
  }

  parts.push(
    '',
    '## Repository knowledge (persistent, source-grounded)',
    overview,
  )

  if (scanner.hypotheses.length > 0) {
    parts.push(
      '',
      '## Hypotheses from the previous scan',
      'These findings were open after the last scan. Independently verify each against the CURRENT repository. For every hypothesis return a verdict in `hypothesisVerdicts`: `resolved` when the problem no longer exists, `improved` when it is partially addressed but still present, `confirmed` when it still exists as described. For `confirmed` and `improved` also return an up-to-date finding with the same `fingerprint` and `previousFindingId` set. Do not report a hypothesis as confirmed without checking the code.',
      '',
      ...scanner.hypotheses.map((hypothesis) =>
        [
          `- previousFindingId: ${hypothesis.findingId}`,
          `  fingerprint: ${hypothesis.fingerprint}`,
          `  title: ${hypothesis.title}`,
          `  severity: ${hypothesis.severity}`,
          `  locations: ${hypothesis.locations
            .map(
              (location) =>
                `${location.path}${location.startLine ? `:${location.startLine}` : ''}${location.symbol ? ` (${location.symbol})` : ''}`,
            )
            .join(', ')}`,
          `  description: ${hypothesis.description.slice(0, 600)}`,
        ].join('\n'),
      ),
    )
  }

  parts.push(
    '',
    '## Task',
    'Analyze the entire repository for this dimension, then also search for new issues beyond the hypotheses. Return the structured result. Prefer a few high-confidence findings over many weak ones; zero new findings is a valid answer when the repository is healthy in this dimension.',
  )
  return parts.join('\n')
}
