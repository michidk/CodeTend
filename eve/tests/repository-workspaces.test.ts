import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { indexWithGitNexus } from '../agent/lib/analysis-tools'
import type { WorkspaceManifest } from '../agent/lib/contract'
import { prepareGitNexusRepository } from '../agent/lib/repository-workspaces'

let temporaryRoot: string | null = null
const originalDataDir = process.env.TECDEBT_DATA_DIR
const originalGitNexusBin = process.env.GITNEXUS_BIN

afterEach(async () => {
  if (originalDataDir === undefined) delete process.env.TECDEBT_DATA_DIR
  else process.env.TECDEBT_DATA_DIR = originalDataDir
  if (originalGitNexusBin === undefined) delete process.env.GITNEXUS_BIN
  else process.env.GITNEXUS_BIN = originalGitNexusBin
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true })
  temporaryRoot = null
})

describe('persistent GitNexus repository', () => {
  test('updates the exact commit while preserving only GitNexus state', async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), 'codetend-gitnexus-'))
    const source = join(temporaryRoot, 'source')
    process.env.TECDEBT_DATA_DIR = join(temporaryRoot, 'data')
    process.env.GITNEXUS_BIN = await writeFakeGitNexus(temporaryRoot)
    await mkdir(source)
    git(source, ['init'])
    git(source, ['config', 'user.email', 'codetend@example.invalid'])
    git(source, ['config', 'user.name', 'CodeTend Test'])
    await writeFile(join(source, 'tracked.txt'), 'first\n')
    git(source, ['add', 'tracked.txt'])
    git(source, ['commit', '-m', 'first'])

    const firstCommit = git(source, ['rev-parse', 'HEAD'])
    const first = await prepareGitNexusRepository(
      42,
      manifest(source, firstCommit),
    )
    expect(git(first.hostPath, ['rev-parse', 'HEAD'])).toBe(firstCommit)
    expect((await indexWithGitNexus(first)).index?.refreshMode).toBe('built')
    expect((await indexWithGitNexus(first)).index?.refreshMode).toBe('reused')

    await mkdir(join(first.hostPath, '.gitnexus'), { recursive: true })
    await writeFile(join(first.hostPath, '.gitnexus', 'sentinel'), 'keep')
    await writeFile(join(first.hostPath, 'stale-untracked.txt'), 'remove')
    await writeFile(join(source, 'tracked.txt'), 'second\n')
    git(source, ['add', 'tracked.txt'])
    git(source, ['commit', '-m', 'second'])

    const secondCommit = git(source, ['rev-parse', 'HEAD'])
    const second = await prepareGitNexusRepository(
      42,
      manifest(source, secondCommit),
    )
    expect(second.hostPath).toBe(first.hostPath)
    expect(git(second.hostPath, ['rev-parse', 'HEAD'])).toBe(secondCommit)
    const refreshed = await indexWithGitNexus(second)
    expect(refreshed.index?.refreshMode).toBe('refreshed')
    expect(refreshed.index?.commitSha).toBe(secondCommit)
    expect(await Bun.file(join(second.hostPath, 'tracked.txt')).text()).toBe(
      'second\n',
    )
    expect(
      await Bun.file(join(second.hostPath, '.gitnexus', 'sentinel')).text(),
    ).toBe('keep')
    expect(
      await Bun.file(join(second.hostPath, 'stale-untracked.txt')).exists(),
    ).toBe(false)
  })
})

function manifest(hostPath: string, commitSha: string): WorkspaceManifest {
  return {
    name: 'repo-42-scan-1',
    hostPath,
    commitSha,
    fileCount: 1,
    files: [],
    topLevel: ['tracked.txt'],
  }
}

function git(cwd: string, args: string[]): string {
  const result = Bun.spawnSync(['git', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString())
  }
  return result.stdout.toString().trim()
}

async function writeFakeGitNexus(root: string): Promise<string> {
  const binary = join(root, 'fake-gitnexus.cjs')
  await writeFile(
    binary,
    `#!/usr/bin/env node
const { execFileSync } = require('node:child_process')
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const repository = process.argv[3]
const directory = join(repository, '.gitnexus')
const target = join(directory, 'gitnexus.json')
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim()
let previous = null
if (existsSync(target)) previous = JSON.parse(readFileSync(target, 'utf8'))
if (!previous || previous.lastCommit !== commit) {
  mkdirSync(directory, { recursive: true })
  writeFileSync(target, JSON.stringify({
    indexedAt: 'indexed-' + commit,
    lastCommit: commit,
    stats: { files: 1, nodes: 2, edges: 1, communities: 0, processes: 0, embeddings: 0 },
    capabilities: { graph: { provider: 'ladybugdb', status: 'available' } },
    runnerIdentity: { cliVersion: 'test', schemaVersion: 4 }
  }))
}
process.stdout.write('Repository indexed successfully\\n')
`,
  )
  await chmod(binary, 0o755)
  return binary
}
