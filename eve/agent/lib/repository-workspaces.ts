import type { PatchRequest, ScanRequest, WorkspaceManifest } from './contract'
import { resolveGitAuth } from './git-auth'
import {
  gitnexusRepositoriesDir,
  gitnexusRepositoryName,
  patchWorkspaceName,
  workspaceName,
  workspacesDir,
} from './paths'
import { assertOk, run } from './process'

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

/**
 * Synchronizes the stable per-repository checkout used by GitNexus to the
 * exact commit already fetched for this scan. The source checkout remains
 * disposable, while `.gitnexus` survives hard resets and source cleanup so
 * GitNexus can reuse its hashes, parse cache, and graph database.
 */
export async function prepareGitNexusRepository(
  repositoryId: number,
  workspace: WorkspaceManifest,
): Promise<WorkspaceManifest> {
  'use step'
  const { existsSync } = await import('node:fs')
  const { mkdir, rm } = await import('node:fs/promises')
  const { join, resolve } = await import('node:path')
  const name = gitnexusRepositoryName(repositoryId)
  const root = resolve(gitnexusRepositoriesDir())
  const hostPath = join(root, name)
  await mkdir(root, { recursive: true })

  if (!existsSync(join(hostPath, '.git'))) {
    await rm(hostPath, { recursive: true, force: true })
    await mkdir(hostPath, { recursive: true })
    const initialized = await run('git', ['init'], { cwd: hostPath })
    assertOk(initialized, `git init of persistent GitNexus repository ${name}`)
  }

  const fetched = await run(
    'git',
    [
      '-c',
      'protocol.file.allow=always',
      'fetch',
      '--no-tags',
      '--depth',
      '1',
      workspace.hostPath,
      workspace.commitSha,
    ],
    { cwd: hostPath, timeoutMs: 10 * 60_000 },
  )
  assertOk(fetched, `git fetch of ${workspace.commitSha} for GitNexus`)
  const checkout = await run(
    'git',
    ['checkout', '--detach', '--force', 'FETCH_HEAD'],
    { cwd: hostPath },
  )
  assertOk(checkout, `git checkout of ${workspace.commitSha} for GitNexus`)
  const cleaned = await run('git', ['clean', '-ffdx', '-e', '.gitnexus/'], {
    cwd: hostPath,
  })
  assertOk(cleaned, `git clean of persistent GitNexus repository ${name}`)

  const head = await run('git', ['rev-parse', 'HEAD'], { cwd: hostPath })
  assertOk(head, 'git rev-parse of persistent GitNexus repository')
  if (head.stdout.trim() !== workspace.commitSha) {
    throw new Error(
      `Persistent GitNexus checkout resolved ${head.stdout.trim()}, expected ${workspace.commitSha}`,
    )
  }
  return { ...workspace, name, hostPath }
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
