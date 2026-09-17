import type {
  CandidateValidation,
  DependencyAuditResult,
  PatchRequest,
  PatchResult,
  ScanCheckpoint,
  ScanRequest,
  ScanResult,
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
import { resolveGitAuth } from './git-auth'
import {
  createGitHubPullRequest,
  type PullRequestReference,
} from './github-pull-request'
import {
  gitnexusHome,
  patchWorkspaceName,
  requestsDir,
  resultsDir,
  workspaceName,
  workspacesDir,
} from './paths'

interface CommandResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

async function run(
  command: string,
  args: readonly string[],
  options: {
    cwd?: string
    env?: Record<string, string>
    timeoutMs?: number
  } = {},
): Promise<CommandResult> {
  const { spawn } = await import('node:child_process')
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    const timer = options.timeoutMs
      ? setTimeout(() => child.kill('SIGKILL'), options.timeoutMs)
      : undefined
    child.once('error', (error) => {
      if (timer) clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code) => {
      if (timer) clearTimeout(timer)
      resolvePromise({ exitCode: code ?? -1, stdout, stderr })
    })
  })
}

function assertOk(result: CommandResult, what: string): void {
  if (result.exitCode !== 0) {
    throw new Error(
      `${what} failed (exit ${result.exitCode}): ${(result.stderr || result.stdout).slice(-2000)}`,
    )
  }
}

export async function readScanRequest(scanId: number): Promise<ScanRequest> {
  'use step'
  const { readFile } = await import('node:fs/promises')
  const raw = await readFile(`${requestsDir()}/scan-${scanId}.json`, 'utf8')
  return JSON.parse(raw) as ScanRequest
}

export async function readPatchRequest(patchId: number): Promise<PatchRequest> {
  'use step'
  const { readFile } = await import('node:fs/promises')
  const raw = await readFile(`${requestsDir()}/patch-${patchId}.json`, 'utf8')
  return JSON.parse(raw) as PatchRequest
}

const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.gitnexus',
  'node_modules',
  'vendor',
  'target',
  'dist',
  'build',
  '.next',
  '.output',
  '.venv',
  'venv',
  '__pycache__',
  '.idea',
  '.vscode',
])

const MAX_HASHED_FILE_BYTES = 2 * 1024 * 1024

async function walk(
  root: string,
  directory: string,
  files: { path: string; hash: string; size: number }[],
): Promise<void> {
  const { readdir, readFile, stat } = await import('node:fs/promises')
  const { createHash } = await import('node:crypto')
  const { join, relative } = await import('node:path')
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue
    const absolute = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue
      await walk(root, absolute, files)
      continue
    }
    if (!entry.isFile()) continue
    const info = await stat(absolute)
    const hash =
      info.size > MAX_HASHED_FILE_BYTES
        ? `size:${info.size}`
        : createHash('sha256')
            .update(await readFile(absolute))
            .digest('hex')
            .slice(0, 16)
    files.push({
      path: relative(root, absolute).replaceAll('\\', '/'),
      hash,
      size: info.size,
    })
  }
}

/**
 * Fresh shallow clone of the configured branch. Any previous workspace for
 * the same scan id is discarded so a retried step never analyzes stale files.
 */
export async function cloneRepository(
  request: ScanRequest,
): Promise<WorkspaceManifest> {
  'use step'
  const { mkdir, readdir, rm } = await import('node:fs/promises')
  const { resolve } = await import('node:path')
  const name = workspaceName(request.repositoryId, request.scanId)
  const hostPath = resolve(workspacesDir(), name)
  await mkdir(workspacesDir(), { recursive: true })
  await rm(hostPath, { recursive: true, force: true })

  const auth = await resolveGitAuth(request.repositoryUrl)
  const clone = await run(
    'git',
    [
      ...auth.gitConfig.flatMap((setting) => ['-c', setting]),
      'clone',
      '--depth',
      '1',
      '--single-branch',
      '--branch',
      request.branch,
      '--no-tags',
      request.repositoryUrl,
      hostPath,
    ],
    {
      env: { GIT_TERMINAL_PROMPT: '0', ...auth.env },
      timeoutMs: 10 * 60_000,
    },
  )
  assertOk(clone, `git clone of ${request.repositoryUrl}#${request.branch}`)

  // Finding revalidation compares the current source with the commit from the
  // previous completed scan. Keep the checkout shallow, but make that exact
  // commit available when the remote still has it.
  if (request.previousCommitSha) {
    const previousPresent = await run(
      'git',
      ['cat-file', '-e', `${request.previousCommitSha}^{commit}`],
      { cwd: hostPath },
    )
    if (previousPresent.exitCode !== 0) {
      await run(
        'git',
        [
          ...auth.gitConfig.flatMap((setting) => ['-c', setting]),
          'fetch',
          '--no-tags',
          '--depth',
          '1',
          'origin',
          request.previousCommitSha,
        ],
        {
          cwd: hostPath,
          env: { GIT_TERMINAL_PROMPT: '0', ...auth.env },
          timeoutMs: 10 * 60_000,
        },
      )
      // Revalidation remains valid without history because current source is
      // authoritative. A pruned or unreachable prior commit is therefore a
      // useful degraded state, not a reason to fail the entire scan.
    }
  }

  if (request.target.kind === 'diff') {
    for (const revision of [request.target.base, request.target.head]) {
      const present = await run(
        'git',
        ['cat-file', '-e', `${revision}^{commit}`],
        {
          cwd: hostPath,
        },
      )
      if (present.exitCode === 0) continue
      const fetched = await run(
        'git',
        [
          ...auth.gitConfig.flatMap((setting) => ['-c', setting]),
          'fetch',
          '--no-tags',
          '--depth',
          '200',
          'origin',
          revision,
        ],
        {
          cwd: hostPath,
          env: { GIT_TERMINAL_PROMPT: '0', ...auth.env },
          timeoutMs: 10 * 60_000,
        },
      )
      assertOk(fetched, `git fetch of revision ${revision}`)
    }
    const checkout = await run(
      'git',
      ['checkout', '--detach', request.target.head],
      { cwd: hostPath },
    )
    assertOk(checkout, `git checkout of ${request.target.head}`)
  }

  const head = await run('git', ['rev-parse', 'HEAD'], { cwd: hostPath })
  assertOk(head, 'git rev-parse HEAD')

  const files: { path: string; hash: string; size: number }[] = []
  await walk(hostPath, hostPath, files)
  files.sort((a, b) => (a.path < b.path ? -1 : 1))
  const topLevel = (await readdir(hostPath))
    .filter((entry) => entry !== '.git')
    .sort()

  return {
    name,
    hostPath,
    commitSha: head.stdout.trim(),
    fileCount: files.length,
    files,
    topLevel,
  }
}

/** Fresh disposable clone pinned to the exact revision a finding came from. */
export async function clonePatchRepository(
  request: PatchRequest,
): Promise<WorkspaceManifest> {
  'use step'
  const { mkdir, readdir, rm } = await import('node:fs/promises')
  const { resolve } = await import('node:path')
  const name = patchWorkspaceName(request.repositoryId, request.patchId)
  const hostPath = resolve(workspacesDir(), name)
  await mkdir(workspacesDir(), { recursive: true })
  await rm(hostPath, { recursive: true, force: true })

  const auth = await resolveGitAuth(request.repositoryUrl)
  const clone = await run(
    'git',
    [
      ...auth.gitConfig.flatMap((setting) => ['-c', setting]),
      'clone',
      '--no-checkout',
      '--filter=blob:none',
      '--no-tags',
      request.repositoryUrl,
      hostPath,
    ],
    {
      env: { GIT_TERMINAL_PROMPT: '0', ...auth.env },
      timeoutMs: 10 * 60_000,
    },
  )
  assertOk(clone, `git clone of ${request.repositoryUrl}`)
  const fetch = await run(
    'git',
    [
      ...auth.gitConfig.flatMap((setting) => ['-c', setting]),
      'fetch',
      '--no-tags',
      '--depth',
      '1',
      'origin',
      request.revision,
    ],
    {
      cwd: hostPath,
      env: { GIT_TERMINAL_PROMPT: '0', ...auth.env },
      timeoutMs: 10 * 60_000,
    },
  )
  assertOk(fetch, `git fetch of revision ${request.revision}`)
  const checkout = await run(
    'git',
    [
      ...auth.gitConfig.flatMap((setting) => ['-c', setting]),
      'checkout',
      '--detach',
      request.revision,
    ],
    {
      cwd: hostPath,
      env: { GIT_TERMINAL_PROMPT: '0', ...auth.env },
    },
  )
  assertOk(checkout, `git checkout of ${request.revision}`)

  const files: { path: string; hash: string; size: number }[] = []
  await walk(hostPath, hostPath, files)
  files.sort((a, b) => (a.path < b.path ? -1 : 1))
  const topLevel = (await readdir(hostPath))
    .filter((entry) => entry !== '.git')
    .sort()
  return {
    name,
    hostPath,
    commitSha: request.revision,
    fileCount: files.length,
    files,
    topLevel,
  }
}

/** Validates and applies a text-only unified diff inside the disposable clone. */
export async function applyGeneratedPatch(input: {
  readonly workspace: WorkspaceManifest
  readonly diff: string
}): Promise<{ diff: string; changedFiles: string[] }> {
  'use step'
  const { lstat, rm, writeFile } = await import('node:fs/promises')
  const { join } = await import('node:path')
  assertSafeUnifiedDiff(input.diff)
  const patchFile = join(input.workspace.hostPath, '.codetend-generated.patch')
  try {
    await writeFile(patchFile, input.diff, { flag: 'wx' })
    const check = await run(
      'git',
      ['apply', '--check', '--whitespace=error-all', '--', patchFile],
      { cwd: input.workspace.hostPath, timeoutMs: 2 * 60_000 },
    )
    assertOk(check, 'git apply --check')
    const apply = await run(
      'git',
      ['apply', '--whitespace=error-all', '--', patchFile],
      { cwd: input.workspace.hostPath, timeoutMs: 2 * 60_000 },
    )
    assertOk(apply, 'git apply')
    const [normalized, names] = await Promise.all([
      run('git', ['diff', '--no-ext-diff', '--no-renames', '--'], {
        cwd: input.workspace.hostPath,
      }),
      run('git', ['diff', '--name-only', '-z', '--diff-filter=ACMD', '--'], {
        cwd: input.workspace.hostPath,
      }),
    ])
    assertOk(normalized, 'git diff')
    assertOk(names, 'git diff --name-only')
    const diff = normalized.stdout.trim()
    if (!diff) throw new Error('The generated patch made no changes.')
    assertSafeUnifiedDiff(diff)
    const changedFiles = names.stdout.split('\0').filter(Boolean).sort()
    for (const path of changedFiles) {
      assertSafePatchPath(path)
      try {
        const metadata = await lstat(join(input.workspace.hostPath, path))
        if (!metadata.isFile()) {
          throw new Error(`Patch output is not a regular file: ${path}`)
        }
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 'ENOENT'
        ) {
          continue
        }
        throw error
      }
    }
    return {
      diff: `${diff}\n`,
      changedFiles,
    }
  } finally {
    await rm(patchFile, { force: true })
  }
}

/** Commits an applied patch, pushes a dedicated branch, and opens its PR. */
export async function publishPatchPullRequest(input: {
  readonly request: PatchRequest
  readonly workspace: WorkspaceManifest
  readonly changedFiles: readonly string[]
  readonly summary: string
}): Promise<PullRequestReference> {
  'use step'
  const branch = `codetend/finding-${input.request.finding.id}-patch-${input.request.patchId}`
  const findingTitle = input.request.finding.title.replace(/\s+/g, ' ').trim()
  const title = `fix: ${findingTitle}`.slice(0, 240)
  const auth = await resolveGitAuth(input.request.repositoryUrl)
  const git = (args: readonly string[], what: string) =>
    run('git', args, {
      cwd: input.workspace.hostPath,
      env: { GIT_TERMINAL_PROMPT: '0', ...auth.env },
      timeoutMs: 10 * 60_000,
    }).then((result) => {
      assertOk(result, what)
      return result
    })

  await git(['checkout', '-b', branch], 'git branch creation')
  await git(['add', '--', ...input.changedFiles], 'git add')
  await git(
    [
      '-c',
      'user.name=CodeTend',
      '-c',
      'user.email=codetend@users.noreply.github.com',
      'commit',
      '-m',
      title,
    ],
    'git commit',
  )
  await git(
    [
      ...auth.gitConfig.flatMap((setting) => ['-c', setting]),
      'push',
      '--set-upstream',
      'origin',
      `HEAD:refs/heads/${branch}`,
    ],
    'git push',
  )

  return createGitHubPullRequest({
    repositoryUrl: input.request.repositoryUrl,
    base: input.request.branch,
    head: branch,
    title,
    body: [
      '## CodeTend finding',
      '',
      `**${input.request.finding.title}** (${input.request.finding.severity})`,
      '',
      input.request.finding.description,
      '',
      '## Generated fix',
      '',
      input.summary,
      '',
      `Finding ID: ${input.request.finding.id} · Patch ID: ${input.request.patchId}`,
    ].join('\n'),
  })
}

export function assertSafeUnifiedDiff(diff: string): void {
  if (
    diff.length === 0 ||
    diff.length > 500_000 ||
    diff.includes('\0') ||
    diff.includes('\r')
  ) {
    throw new Error(
      'Patch is empty, oversized, or contains unsupported control bytes.',
    )
  }
  if (/^(?:GIT binary patch|Binary files )/m.test(diff)) {
    throw new Error('Binary patches are not accepted.')
  }
  if (
    /^(?:(?:(?:new|deleted) file|new|old) mode (?:120000|160000)|Submodule )/m.test(
      diff,
    )
  ) {
    throw new Error('Symlink patches and submodule patches are not accepted.')
  }
  if (/^(?:rename|copy) (?:from|to) |^(?:dis)?similarity index /m.test(diff)) {
    throw new Error('Rename and copy patches are not accepted.')
  }
  const paths = [...diff.matchAll(/^(?:---|\+\+\+) ([^\t\n]+)(?:\t[^\n]*)?$/gm)]
    .map((match) => match[1])
    .filter((path): path is string => Boolean(path) && path !== '/dev/null')
  if (paths.length === 0) throw new Error('Patch has no unified diff paths.')
  for (const path of paths) {
    if (path.startsWith('"')) {
      throw new Error('Patch contains an unsupported quoted path.')
    }
    assertSafePatchPath(path.replace(/^[ab]\//, ''))
  }
  const sections = [...diff.matchAll(/^diff --git ([^\t\n]+)$/gm)]
  if (sections.length === 0 || sections.length > 50) {
    throw new Error('Patch must contain between 1 and 50 file sections.')
  }
  for (const section of sections) {
    const header = section[1]
    if (!header || header.startsWith('"') || !/^a\/.+ b\/.+$/.test(header)) {
      throw new Error('Patch contains an unsupported diff path header.')
    }
    const separator = header.lastIndexOf(' b/')
    if (separator <= 2) {
      throw new Error('Patch contains an unsupported diff path header.')
    }
    assertSafePatchPath(header.slice(2, separator))
    assertSafePatchPath(header.slice(separator + 3))
  }
}

function assertSafePatchPath(path: string): void {
  if (
    path.length === 0 ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.includes('\t') ||
    path.split('/').some((segment) => segment === '' || segment === '..') ||
    path === '.git' ||
    path.startsWith('.git/') ||
    path === '.codetend-generated.patch'
  ) {
    throw new Error(`Unsafe patch path: ${path}`)
  }
}

export async function writePatchResult(result: PatchResult): Promise<void> {
  'use step'
  const { mkdir, rename, writeFile } = await import('node:fs/promises')
  await mkdir(resultsDir(), { recursive: true })
  const target = `${resultsDir()}/patch-${result.patchId}.json`
  await writeFile(`${target}.tmp`, JSON.stringify(result))
  await rename(`${target}.tmp`, target)
}

/** Resolves repository-relative paths changed by a diff-scoped scan. */
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
    const result = await run(
      binary,
      [
        'analyze',
        workspace.hostPath,
        '--index-only',
        '--name',
        workspace.name,
        '--allow-duplicate-name',
      ],
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
      }
    }
    const summary = result.stdout
      .split('\n')
      .filter((line) => /nodes|indexed/i.test(line))
      .join(' ')
      .trim()
    return { ok: true, detail: summary || 'indexed' }
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    }
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
      }
    }
    return {
      status: 'completed',
      report: JSON.parse(scan.stdout) as unknown,
      toolVersion: version.stdout.trim() || undefined,
    }
  } catch (error) {
    return {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

interface ValidationCandidate {
  readonly scannerId: string
  readonly fingerprint: string
  readonly validationPlan?: {
    readonly method: string
    readonly commands: readonly {
      readonly command: string
      readonly purpose: string
      readonly timeoutSeconds: number
    }[]
  }
}

/**
 * Runs model-proposed reproduction commands in disposable, credential-free
 * Docker containers. The checkout is mounted read-only and copied into a
 * throwaway workspace; networking and Linux capabilities are disabled.
 */
export async function validateCandidates(input: {
  readonly request: ScanRequest
  readonly workspace: WorkspaceManifest
  readonly candidates: readonly ValidationCandidate[]
}): Promise<CandidateValidation[]> {
  'use step'
  const candidates = input.candidates.slice(0, 12)
  if (candidates.length === 0) return []
  if (
    !input.request.validation.enabled ||
    input.request.validation.runner === 'disabled'
  ) {
    return candidates.map((candidate) =>
      unavailableValidation(candidate, 'disabled'),
    )
  }

  const docker = await run(
    'docker',
    ['version', '--format', '{{.Server.Version}}'],
    {
      timeoutMs: 15_000,
    },
  ).catch(() => null)
  if (docker?.exitCode !== 0) {
    return candidates.map((candidate) =>
      unavailableValidation(
        candidate,
        'Docker is unavailable; no unisolated fallback was attempted.',
      ),
    )
  }

  const results: CandidateValidation[] = []
  for (const candidate of candidates) {
    const validationPlan = candidate.validationPlan
    if (!validationPlan) {
      results.push({
        ...unavailableValidation(
          candidate,
          'No safe executable validation plan was provided.',
        ),
        status: 'not_run',
        method: 'static-review',
      })
      continue
    }
    results.push(
      await runCandidateValidation({
        candidate: { ...candidate, validationPlan },
        workspace: input.workspace,
        image: input.request.validation.image,
      }),
    )
  }
  return results
}

async function runCandidateValidation(input: {
  readonly candidate: ValidationCandidate & {
    readonly validationPlan: NonNullable<ValidationCandidate['validationPlan']>
  }
  readonly workspace: WorkspaceManifest
  readonly image: string
}): Promise<CandidateValidation> {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const started = Date.now()
  const scratch = await mkdtemp(join(tmpdir(), 'codetend-validation-'))
  let containerId = ''
  const commands: CandidateValidation['commands'][number][] = []
  try {
    const created = await run(
      'docker',
      [
        'create',
        '--network',
        'none',
        '--cap-drop',
        'ALL',
        '--security-opt',
        'no-new-privileges',
        '--pids-limit',
        '256',
        '--memory',
        '2g',
        '--cpus',
        '2',
        '--read-only',
        '--tmpfs',
        '/tmp:rw,noexec,nosuid,nodev,size=256m',
        '--mount',
        `type=bind,src=${input.workspace.hostPath},dst=/source,readonly`,
        '--mount',
        `type=bind,src=${scratch},dst=/workspace`,
        input.image,
        'sh',
        '-lc',
        'cp -a /source/. /workspace/ && exec sleep infinity',
      ],
      { timeoutMs: 2 * 60_000 },
    )
    if (created.exitCode !== 0) {
      return failedValidation(
        input.candidate,
        `Could not create the isolated validation container: ${trimOutput(created.stderr || created.stdout)}`,
      )
    }
    containerId = created.stdout.trim()
    const start = await run('docker', ['start', containerId], {
      timeoutMs: 2 * 60_000,
    })
    if (start.exitCode !== 0) {
      return failedValidation(
        input.candidate,
        `Could not start the isolated validation container: ${trimOutput(start.stderr || start.stdout)}`,
      )
    }

    for (const command of input.candidate.validationPlan.commands) {
      const commandStarted = Date.now()
      const result = await run(
        'docker',
        [
          'exec',
          '--workdir',
          '/workspace',
          containerId,
          'sh',
          '-lc',
          command.command,
        ],
        { timeoutMs: command.timeoutSeconds * 1_000 },
      )
      const timedOut = result.exitCode === -1
      commands.push({
        ...command,
        exitCode: timedOut ? null : result.exitCode,
        stdout: trimOutput(result.stdout),
        stderr: trimOutput(result.stderr),
        timedOut,
        durationMs: Date.now() - commandStarted,
      })
      if (timedOut || result.exitCode !== 0) break
    }

    const final = commands.at(-1)
    const allStepsRan =
      commands.length === input.candidate.validationPlan.commands.length
    const status = final?.timedOut
      ? 'inconclusive'
      : !allStepsRan
        ? 'inconclusive'
        : final?.exitCode === 0
          ? 'confirmed'
          : 'not_reproduced'
    return {
      scannerId: input.candidate.scannerId,
      fingerprint: input.candidate.fingerprint,
      status,
      method: input.candidate.validationPlan.method,
      summary:
        status === 'confirmed'
          ? 'The complete isolated validation plan exited successfully.'
          : status === 'not_reproduced'
            ? 'The reproducer completed but did not confirm the vulnerability.'
            : 'Validation could not reach a conclusive reproduction result.',
      commands,
      proofGaps:
        status === 'confirmed'
          ? []
          : [
              'The proposed executable validation did not conclusively reproduce the claimed vulnerable behavior.',
            ],
      runner: `docker:${input.image}`,
      validatedAt: new Date(started).toISOString(),
    }
  } catch (error) {
    return failedValidation(
      input.candidate,
      error instanceof Error ? error.message : String(error),
    )
  } finally {
    if (containerId) {
      await run('docker', ['rm', '--force', containerId], {
        timeoutMs: 30_000,
      }).catch(() => undefined)
    }
    await rm(scratch, { recursive: true, force: true })
  }
}

function unavailableValidation(
  candidate: ValidationCandidate,
  reason: string,
): CandidateValidation {
  return {
    scannerId: candidate.scannerId,
    fingerprint: candidate.fingerprint,
    status: 'unavailable',
    method: candidate.validationPlan?.method ?? 'static-review',
    summary: reason,
    commands: [],
    proofGaps: [reason],
    runner: 'none',
    validatedAt: new Date().toISOString(),
  }
}

function failedValidation(
  candidate: ValidationCandidate,
  reason: string,
): CandidateValidation {
  return {
    ...unavailableValidation(candidate, reason),
    status: 'error',
    runner: 'docker',
  }
}

function trimOutput(value: string): string {
  const limit = 16_000
  return value.length <= limit
    ? value
    : `${value.slice(0, limit)}\n[output truncated]`
}

export async function writeScanResult(result: ScanResult): Promise<void> {
  'use step'
  const { mkdir, rename, writeFile } = await import('node:fs/promises')
  await mkdir(resultsDir(), { recursive: true })
  const target = `${resultsDir()}/scan-${result.scanId}.json`
  await writeFile(`${target}.tmp`, JSON.stringify(result, null, 2))
  await rename(`${target}.tmp`, target)
}

export async function readScanCheckpoint(
  scanId: number,
): Promise<ScanCheckpoint | null> {
  'use step'
  const { readFile } = await import('node:fs/promises')
  try {
    return JSON.parse(
      await readFile(`${resultsDir()}/scan-${scanId}.checkpoint.json`, 'utf8'),
    ) as ScanCheckpoint
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return null
    }
    throw error
  }
}

export async function writeScanCheckpoint(
  checkpoint: ScanCheckpoint,
): Promise<void> {
  'use step'
  const { mkdir, rename, writeFile } = await import('node:fs/promises')
  await mkdir(resultsDir(), { recursive: true })
  const target = `${resultsDir()}/scan-${checkpoint.scanId}.checkpoint.json`
  await writeFile(`${target}.tmp`, JSON.stringify(checkpoint, null, 2))
  await rename(`${target}.tmp`, target)
}

export async function nowIso(): Promise<string> {
  'use step'
  return new Date().toISOString()
}
