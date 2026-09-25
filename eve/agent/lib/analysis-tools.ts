import type {
  DependencyAuditResult,
  GitNexusIndexMetadata,
  ScanRequest,
  SubsystemDependencyGraph,
  WorkspaceManifest,
} from './contract'
import {
  buildSubsystemDependencyGraph,
  parseCyclesReport,
  parseFileEdges,
  SUBSYSTEM_IMPORT_EDGES_QUERY,
  type SubsystemNode,
  UNAVAILABLE_DEPENDENCY_GRAPH,
} from './dependency-graph'
import { gitnexusHome } from './paths'
import { assertOk, run } from './process'

export async function resolveDiffTargetFiles(
  request: ScanRequest,
  workspace: WorkspaceManifest,
): Promise<string[]> {
  'use step'
  if (request.target.kind !== 'diff') return []

  const diff = await run(
    'git',
    [
      'diff',
      '--name-only',
      '--diff-filter=ACDMRT',
      request.target.base,
      request.target.head,
      '--',
    ],
    { cwd: workspace.hostPath, timeoutMs: 2 * 60_000 },
  )
  assertOk(diff, 'git diff target resolution')
  return [
    ...new Set(
      diff.stdout
        .split('\n')
        .filter((path) => path.trim().length > 0)
        .map(normalizeTargetPath),
    ),
  ].sort()
}

function normalizeTargetPath(path: string): string {
  const normalized = path.trim().replaceAll('\\', '/').replace(/^\.\//, '')
  if (
    normalized.length === 0 ||
    normalized.startsWith('/') ||
    normalized.split('/').includes('..')
  ) {
    throw new Error(`Unsafe scan target path: ${path}`)
  }
  return normalized.replace(/\/$/, '')
}

export interface GitNexusIndexResult {
  readonly ok: boolean
  readonly detail: string
  readonly index: GitNexusIndexMetadata | null
}

interface GitNexusMetadataFile {
  readonly indexedAt?: unknown
  readonly lastCommit?: unknown
  readonly stats?: unknown
  readonly capabilities?: unknown
  readonly runnerIdentity?: unknown
}

/**
 * Optional enrichment: index the fresh checkout with GitNexus. The MCP
 * server started by the app serves every repository registered under the
 * shared GITNEXUS_HOME registry, so agents can query this index by name.
 */
export async function indexWithGitNexus(
  workspace: WorkspaceManifest,
): Promise<GitNexusIndexResult> {
  'use step'
  const { existsSync } = await import('node:fs')
  const { homedir } = await import('node:os')
  const { resolve } = await import('node:path')
  const binary =
    [
      process.env.GITNEXUS_BIN,
      resolve('../.tools/node_modules/.bin/gitnexus'),
      `${homedir()}/.local/bin/gitnexus`,
      '/usr/local/bin/gitnexus',
    ].find((candidate) => candidate && existsSync(candidate)) ?? 'gitnexus'
  try {
    const { readFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const metadataPath = join(workspace.hostPath, '.gitnexus', 'gitnexus.json')
    const before = await readGitNexusMetadata(metadataPath, readFile)
    const result = await run(
      binary,
      ['analyze', workspace.hostPath, '--index-only', '--name', workspace.name],
      {
        env: {
          GITNEXUS_HOME: gitnexusHome(),
          GITNEXUS_NO_UPDATE_NOTIFIER: '1',
          GITNEXUS_LBUG_EXTENSION_INSTALL: 'auto',
        },
        timeoutMs: 20 * 60_000,
      },
    )
    if (result.exitCode !== 0) {
      return {
        ok: false,
        detail: (result.stderr || result.stdout).slice(-1500),
        index: null,
      }
    }
    const after = await readGitNexusMetadata(metadataPath, readFile)
    if (!after || after.lastCommit !== workspace.commitSha) {
      return {
        ok: false,
        detail: `GitNexus metadata did not confirm commit ${workspace.commitSha}`,
        index: null,
      }
    }
    const summary = result.stdout
      .split('\n')
      .filter((line) => /nodes|indexed/i.test(line))
      .join(' ')
      .trim()
    return {
      ok: true,
      detail: summary || 'indexed',
      index: toGitNexusIndexMetadata(workspace.name, before, after),
    }
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
      index: null,
    }
  }
}

async function readGitNexusMetadata(
  path: string,
  readFile: (path: string, encoding: 'utf8') => Promise<string>,
): Promise<GitNexusMetadataFile | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as GitNexusMetadataFile
  } catch {
    return null
  }
}

function toGitNexusIndexMetadata(
  repository: string,
  before: GitNexusMetadataFile | null,
  after: GitNexusMetadataFile,
): GitNexusIndexMetadata {
  if (typeof after.indexedAt !== 'string') {
    throw new Error('GitNexus metadata is missing indexedAt')
  }
  const stats = asRecord(after.stats)
  const runnerIdentity = asRecord(after.runnerIdentity)
  return {
    repository,
    commitSha: after.lastCommit as string,
    indexedAt: after.indexedAt,
    refreshMode:
      before === null
        ? 'built'
        : before.lastCommit === after.lastCommit &&
            before.indexedAt === after.indexedAt
          ? 'reused'
          : 'refreshed',
    cliVersion:
      typeof runnerIdentity.cliVersion === 'string'
        ? runnerIdentity.cliVersion
        : null,
    schemaVersion:
      typeof runnerIdentity.schemaVersion === 'number'
        ? runnerIdentity.schemaVersion
        : null,
    stats: {
      files: nonnegativeInteger(stats.files),
      nodes: nonnegativeInteger(stats.nodes),
      edges: nonnegativeInteger(stats.edges),
      communities: nonnegativeInteger(stats.communities),
      processes: nonnegativeInteger(stats.processes),
      embeddings: nonnegativeInteger(stats.embeddings),
    },
    capabilities: gitnexusCapabilities(after.capabilities),
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function nonnegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : 0
}

function gitnexusCapabilities(
  value: unknown,
): GitNexusIndexMetadata['capabilities'] {
  const capabilities = asRecord(value)
  return {
    graph: gitnexusCapability(capabilities.graph),
    fts: gitnexusCapability(capabilities.fts),
    vectorSearch: gitnexusCapability(capabilities.vectorSearch),
  }
}

function gitnexusCapability(
  value: unknown,
): GitNexusIndexMetadata['capabilities']['graph'] {
  const capability = asRecord(value)
  if (
    typeof capability.provider !== 'string' ||
    typeof capability.status !== 'string'
  ) {
    return undefined
  }
  return {
    provider: capability.provider,
    status: capability.status,
    ...(typeof capability.exactScanLimit === 'number' &&
    Number.isInteger(capability.exactScanLimit) &&
    capability.exactScanLimit >= 0
      ? { exactScanLimit: capability.exactScanLimit }
      : {}),
  }
}

/**
 * Optional enrichment: deterministically extracts a subsystem-level import
 * graph and circular-import report from the GitNexus index, using the same
 * `cypher`/`check` CLI the MCP server exposes to agents. Maps GitNexus's
 * file-level edges onto the subsystem names the knowledge agent already
 * produced (`buildSubsystemDependencyGraph`); never throws, degrading to
 * `UNAVAILABLE_DEPENDENCY_GRAPH` on any failure since this is enrichment
 * only, same policy as `indexWithGitNexus`.
 */
export async function extractSubsystemDependencyGraph(
  gitnexusRepo: string,
  subsystems: readonly SubsystemNode[],
): Promise<SubsystemDependencyGraph> {
  'use step'
  const { existsSync } = await import('node:fs')
  const { homedir } = await import('node:os')
  const { resolve } = await import('node:path')
  const binary =
    [
      process.env.GITNEXUS_BIN,
      resolve('../.tools/node_modules/.bin/gitnexus'),
      `${homedir()}/.local/bin/gitnexus`,
      '/usr/local/bin/gitnexus',
    ].find((candidate) => candidate && existsSync(candidate)) ?? 'gitnexus'
  const env = {
    GITNEXUS_HOME: gitnexusHome(),
    GITNEXUS_NO_UPDATE_NOTIFIER: '1',
  }
  try {
    const [edgesResult, cyclesResult] = await Promise.all([
      run(
        binary,
        ['cypher', SUBSYSTEM_IMPORT_EDGES_QUERY, '-r', gitnexusRepo],
        { env, timeoutMs: 60_000 },
      ),
      run(binary, ['check', '--cycles', '--json', '-r', gitnexusRepo], {
        env,
        timeoutMs: 60_000,
      }),
    ])
    // `check --cycles` exits 1 when it finds cycles; that's a normal result,
    // not a failure, so its exit code is ignored here.
    const fileEdges =
      edgesResult.exitCode === 0 ? parseFileEdges(edgesResult.stdout) : []
    const cyclesReport = parseCyclesReport(cyclesResult.stdout)
    return buildSubsystemDependencyGraph(subsystems, fileEdges, cyclesReport)
  } catch {
    return UNAVAILABLE_DEPENDENCY_GRAPH
  }
}

/** Runs Google's OSV Scanner over supported manifests and lockfiles. */
export async function auditDependencies(
  workspace: WorkspaceManifest,
): Promise<DependencyAuditResult> {
  'use step'
  const { existsSync } = await import('node:fs')
  const { homedir } = await import('node:os')
  const { delimiter, join, resolve } = await import('node:path')
  const pathCandidates = (process.env.PATH ?? '')
    .split(delimiter)
    .filter(Boolean)
    .map((directory) => join(directory, 'osv-scanner'))
  const binary = [
    process.env.OSV_SCANNER_BIN,
    resolve('../.tools/osv-scanner'),
    `${homedir()}/.local/bin/osv-scanner`,
    '/usr/local/bin/osv-scanner',
    ...pathCandidates,
  ].find((candidate) => candidate && existsSync(candidate))

  if (!binary) {
    return {
      status: 'unavailable',
      error:
        'osv-scanner is not installed. Set OSV_SCANNER_BIN or install it in .tools/osv-scanner.',
      exploitabilityAssessments: [],
    }
  }

  try {
    const [scan, version] = await Promise.all([
      run(
        binary,
        [
          'scan',
          'source',
          '--format',
          'json',
          '--recursive',
          // A repository without lockfiles is a valid empty audit, not an
          // error (osv-scanner otherwise exits 128 with "No package sources").
          '--allow-no-lockfiles',
          workspace.hostPath,
        ],
        { timeoutMs: 15 * 60_000 },
      ),
      run(binary, ['--version'], { timeoutMs: 30_000 }),
    ])
    // OSV Scanner exits 1 when it found vulnerabilities and >1 on errors.
    if (scan.exitCode !== 0 && scan.exitCode !== 1) {
      return {
        status: 'failed',
        error: (scan.stderr || scan.stdout).slice(-2000),
        toolVersion: version.stdout.trim() || undefined,
        exploitabilityAssessments: [],
      }
    }
    return {
      status: 'completed',
      report: JSON.parse(scan.stdout) as unknown,
      toolVersion: version.stdout.trim() || undefined,
      exploitabilityAssessments: [],
    }
  } catch (error) {
    return {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
      exploitabilityAssessments: [],
    }
  }
}
