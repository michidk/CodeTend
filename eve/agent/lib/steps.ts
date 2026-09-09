import type { ScanRequest, ScanResult, WorkspaceManifest } from './contract'
import {
  gitnexusHome,
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

  const clone = await run(
    'git',
    [
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
    { env: { GIT_TERMINAL_PROMPT: '0' }, timeoutMs: 10 * 60_000 },
  )
  assertOk(clone, `git clone of ${request.repositoryUrl}#${request.branch}`)

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
  const binary =
    [
      process.env.GITNEXUS_BIN,
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

export async function writeScanResult(result: ScanResult): Promise<void> {
  'use step'
  const { mkdir, rename, writeFile } = await import('node:fs/promises')
  await mkdir(resultsDir(), { recursive: true })
  const target = `${resultsDir()}/scan-${result.scanId}.json`
  await writeFile(`${target}.tmp`, JSON.stringify(result, null, 2))
  await rename(`${target}.tmp`, target)
}

export async function nowIso(): Promise<string> {
  'use step'
  return new Date().toISOString()
}
