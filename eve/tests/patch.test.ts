import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyGeneratedPatch, assertSafeUnifiedDiff } from '../agent/lib/steps'

describe('generated patch boundary', () => {
  test('accepts a text-only repository-relative unified diff', () => {
    expect(() =>
      assertSafeUnifiedDiff(
        [
          'diff --git a/src/auth.ts b/src/auth.ts',
          '--- a/src/auth.ts',
          '+++ b/src/auth.ts',
          '@@ -1 +1 @@',
          '-unsafe()',
          '+safe()',
          '',
        ].join('\n'),
      ),
    ).not.toThrow()
  })

  test('rejects traversal, absolute paths, binary patches, and symlinks', () => {
    expect(() =>
      assertSafeUnifiedDiff('--- a/src/auth.ts\n+++ b/../../etc/passwd\n'),
    ).toThrow('Unsafe patch path')
    expect(() =>
      assertSafeUnifiedDiff('--- a/src/auth.ts\n+++ /etc/passwd\n'),
    ).toThrow('Unsafe patch path')
    expect(() =>
      assertSafeUnifiedDiff(
        'diff --git a/a b/a\nGIT binary patch\n--- a/a\n+++ b/a\n',
      ),
    ).toThrow('Binary patches')
    expect(() =>
      assertSafeUnifiedDiff(
        'diff --git a/link b/link\nnew file mode 120000\n--- /dev/null\n+++ b/link\n',
      ),
    ).toThrow('Symlink patches')
  })

  test('rejects metadata-only operations and hidden Git control paths', () => {
    expect(() =>
      assertSafeUnifiedDiff(
        [
          'diff --git a/old.ts b/new.ts',
          'similarity index 100%',
          'rename from old.ts',
          'rename to new.ts',
          '--- a/safe.ts',
          '+++ b/safe.ts',
          '',
        ].join('\n'),
      ),
    ).toThrow('Rename and copy patches')
    expect(() =>
      assertSafeUnifiedDiff(
        [
          'diff --git a/.git/config b/.git/config',
          '--- a/.git/config',
          '+++ b/.git/config',
          '@@ -1 +1 @@',
          '-safe',
          '+unsafe',
          '',
        ].join('\n'),
      ),
    ).toThrow('Unsafe patch path')
    expect(() =>
      assertSafeUnifiedDiff(
        [
          'diff --git "a/src/quoted name.ts" "b/src/quoted name.ts"',
          '--- "a/src/quoted name.ts"',
          '+++ "b/src/quoted name.ts"',
          '',
        ].join('\n'),
      ),
    ).toThrow('unsupported quoted path')
  })

  test('checks, applies, and normalizes a patch only in its workspace', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'tecdebt-patch-test-'))
    try {
      await writeFile(join(repository, 'auth.ts'), 'unsafe()\n')
      const initialized = Bun.spawnSync(['git', 'init', '--quiet'], {
        cwd: repository,
      })
      expect(initialized.exitCode).toBe(0)
      const staged = Bun.spawnSync(['git', 'add', 'auth.ts'], {
        cwd: repository,
      })
      expect(staged.exitCode).toBe(0)

      const result = await applyGeneratedPatch({
        workspace: {
          name: 'patch-test',
          hostPath: repository,
          commitSha: 'test',
          fileCount: 1,
          files: [],
          topLevel: ['auth.ts'],
        },
        diff: [
          'diff --git a/auth.ts b/auth.ts',
          '--- a/auth.ts',
          '+++ b/auth.ts',
          '@@ -1 +1 @@',
          '-unsafe()',
          '+safe()',
          '',
        ].join('\n'),
      })

      expect(await readFile(join(repository, 'auth.ts'), 'utf8')).toBe(
        'safe()\n',
      )
      expect(result.changedFiles).toEqual(['auth.ts'])
      expect(result.diff).toContain('+safe()')
    } finally {
      await rm(repository, { recursive: true, force: true })
    }
  })
})
