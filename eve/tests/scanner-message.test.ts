import { describe, expect, test } from 'bun:test'
import type {
  KnowledgeResult,
  ScanRequestScanner,
  WorkspaceManifest,
} from '../agent/lib/contract'
import { scannerAgentMessage } from '../agent/lib/scanner-message'

const scanner: ScanRequestScanner = {
  id: 'architecture',
  name: 'Architecture',
  prompt: 'Review architectural boundaries.',
  attentionHistory: [],
  hypotheses: [
    {
      findingId: 42,
      fingerprint: 'leaky-service-boundary',
      title: 'Service boundary leaks persistence details',
      severity: 'high',
      description: 'The service exposes database records to callers.',
      locations: [{ path: 'src/service.ts', startLine: 10 }],
    },
  ],
}

const workspace: WorkspaceManifest = {
  name: 'repo-1-scan-2',
  hostPath: '/data/workspaces/repo-1-scan-2',
  commitSha: 'current123',
  fileCount: 2,
  files: [],
  topLevel: ['src'],
}

const knowledge: KnowledgeResult = {
  refreshed: true,
  overview: 'A small service.',
  summary: {
    languages: ['TypeScript'],
    frameworks: [],
    subsystems: [],
    concepts: [],
  },
  sources: [],
  reason: 'Repository changed.',
  dependencyGraph: {
    edges: [],
    cycles: [],
    cycleStatus: 'clean',
    componentCount: 0,
  },
}

function message(
  overrides: Partial<Parameters<typeof scannerAgentMessage>[0]> = {},
) {
  return scannerAgentMessage({
    scanner,
    siblingScanners: [scanner],
    repoPath: '/workspace/repos/repo-1-scan-2',
    repositoryName: 'example',
    workspace,
    knowledge,
    gitnexusRepo: null,
    previousCommitSha: 'previous456',
    target: { kind: 'repository' },
    maxInputTokens: 20_000,
    attentionHistory: [],
    securityProfile: null,
    ...overrides,
  })
}

describe('scannerAgentMessage scan phases', () => {
  test('runs a per-scanner precheck before normal discovery', () => {
    const prompt = message()

    expect(prompt).toContain('first stage of your scan')
    expect(prompt).toContain('Inspect the CURRENT code first')
    expect(prompt).toContain('use git diff/log')
    expect(prompt).toContain(
      'never resolve a finding from commit history alone',
    )
    expect(prompt).toContain(
      'First explicitly verify every hypothesis above as a precheck',
    )
    expect(prompt).toContain(
      'Only after every existing finding has a verdict, continue with the normal bounded investigation',
    )
  })
})
