import { describe, expect, test } from 'bun:test'
import type {
  PreviousKnowledge,
  WorkspaceManifest,
} from '../agent/lib/contract'
import { assessKnowledgeStaleness } from '../agent/lib/knowledge'

function workspace(
  files: Record<string, string>,
  overrides: Partial<WorkspaceManifest> = {},
): WorkspaceManifest {
  const entries = Object.entries(files).map(([path, hash]) => ({
    path,
    hash,
    size: 1,
  }))
  return {
    name: 'acme/shop',
    hostPath: '/tmp/acme-shop',
    commitSha: 'abc123',
    fileCount: entries.length,
    files: entries,
    topLevel: [
      ...new Set(entries.map((file) => file.path.split('/')[0] ?? file.path)),
    ],
    ...overrides,
  }
}

const previous: PreviousKnowledge = {
  overview: '# acme/shop',
  summary: {
    languages: ['TypeScript'],
    frameworks: [],
    subsystems: [
      { name: 'API', paths: ['src/api'], responsibility: 'HTTP handlers' },
    ],
    concepts: [],
    securityProfile: {
      projectOverview: 'An HTTP API.',
      assets: ['Application data'],
      entryPoints: ['HTTP requests'],
      trustBoundaries: ['Internet clients to the API'],
      authAssumptions: [],
      sensitiveDataPaths: [],
      privilegedActions: [],
      securityInvariants: [],
      priorities: [],
      exclusions: [],
    },
  },
  sources: [
    { path: 'package.json', hash: 'p1' },
    { path: 'src/api/index.ts', hash: 'a1' },
  ],
  fileCount: 2,
}

describe('assessKnowledgeStaleness', () => {
  test('always refreshes without previous knowledge', () => {
    const report = assessKnowledgeStaleness(null, workspace({}), null)
    expect(report.refreshNeeded).toBe(true)
    expect(report.reason).toContain('No previous repository knowledge')
  })

  test('keeps knowledge when grounding files are unchanged', () => {
    const report = assessKnowledgeStaleness(
      previous,
      workspace({ 'package.json': 'p1', 'src/api/index.ts': 'a1' }),
      2,
    )
    expect(report.refreshNeeded).toBe(false)
    expect(report.reason).toBe('All grounding files are unchanged.')
  })

  test('refreshes legacy knowledge without an inferred security profile', () => {
    const legacy = {
      ...previous,
      summary: { ...previous.summary, securityProfile: undefined },
    }
    const report = assessKnowledgeStaleness(
      legacy,
      workspace({ 'package.json': 'p1', 'src/api/index.ts': 'a1' }),
      2,
    )
    expect(report.refreshNeeded).toBe(true)
    expect(report.reason).toContain('security profile has not been inferred')
  })

  test('refreshes when a grounding file changed or disappeared', () => {
    const report = assessKnowledgeStaleness(
      previous,
      workspace({ 'package.json': 'p2' }),
      2,
    )
    expect(report.refreshNeeded).toBe(true)
    expect(report.changedSources).toEqual(['package.json'])
    expect(report.removedSources).toEqual(['src/api/index.ts'])
  })

  test('refreshes for new top-level directories but not new root files', () => {
    const withRootFile = assessKnowledgeStaleness(
      previous,
      workspace({
        'package.json': 'p1',
        'src/api/index.ts': 'a1',
        LICENSE: 'l1',
      }),
      2,
    )
    expect(withRootFile.newTopLevelEntries).toEqual([])

    const withDirectory = assessKnowledgeStaleness(
      previous,
      workspace({
        'package.json': 'p1',
        'src/api/index.ts': 'a1',
        'worker/main.go': 'w1',
      }),
      3,
    )
    expect(withDirectory.refreshNeeded).toBe(true)
    expect(withDirectory.newTopLevelEntries).toEqual(['worker'])
    expect(withDirectory.reason).toContain('new top-level entries: worker')
  })

  test('ignores dot-directories and paths the subsystems already cover', () => {
    const report = assessKnowledgeStaleness(
      previous,
      workspace({
        'package.json': 'p1',
        'src/api/index.ts': 'a1',
        '.github/workflows/ci.yml': 'c1',
        'src/api/users.ts': 'u1',
      }),
      4,
    )
    expect(report.newTopLevelEntries).toEqual([])
    expect(report.refreshNeeded).toBe(false)
  })

  test('refreshes when the tracked file count drifts by more than a fifth', () => {
    const files = Object.fromEntries(
      Array.from({ length: 30 }, (_, index) => [
        `src/api/module-${index}.ts`,
        `m${index}`,
      ]),
    )
    const report = assessKnowledgeStaleness(
      previous,
      workspace({ 'package.json': 'p1', 'src/api/index.ts': 'a1', ...files }),
      20,
    )
    expect(report.refreshNeeded).toBe(true)
    expect(report.reason).toContain('file count drifted by 60%')
  })
})
