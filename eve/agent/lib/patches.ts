import type { WorkspaceManifest } from './contract'
import { assertOk, run } from './process'

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
