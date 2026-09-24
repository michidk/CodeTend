import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  CandidateValidation,
  PatchRequest,
  PatchResult,
} from '../agent/lib/contract'
import { applyGeneratedPatch, assertSafeUnifiedDiff } from '../agent/lib/steps'
import runFix, { patchResultAfterValidation } from '../agent/tools/run_fix'

const validation = (
  status: CandidateValidation['status'],
): CandidateValidation => ({
  scannerId: 'security',
  fingerprint: 'patch-1',
  status,
  method: 'test',
  summary: `Validation ${status}`,
  commands: [],
})

describe('generated patch boundary', () => {
  test('maps remediation validation outcomes to durable patch states', () => {
    const input = {
      patchId: 1,
      candidate: {
        summary: 'Applied a focused fix.',
        testRecommendations: ['Run the focused test.'],
      },
      applied: { diff: '+safe()', changedFiles: ['auth.ts'] },
      finishedAt: '2026-09-24T00:00:00.000Z',
    }

    expect(
      patchResultAfterValidation({
        ...input,
        verification: validation('confirmed'),
      }).result,
    ).toMatchObject({
      status: 'failed',
      error: 'The finding still reproduced after applying the generated patch.',
    })
    expect(
      patchResultAfterValidation({
        ...input,
        verification: validation('not_reproduced'),
      }).result.status,
    ).toBe('verified')
    expect(
      patchResultAfterValidation({
        ...input,
        verification: validation('inconclusive'),
      }).result.status,
    ).toBe('proposed')
    expect(
      patchResultAfterValidation({
        ...input,
        verification: validation('unavailable'),
      }).result.status,
    ).toBe('proposed')
  })

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
    const repository = await mkdtemp(join(tmpdir(), 'codetend-patch-test-'))
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

  test('runs the fixer workflow through success and failure outcomes offline', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codetend-fix-workflow-test-'))
    const repository = join(root, 'repository')
    const dataDir = join(root, 'data')
    const previousDataDir = process.env.TECDEBT_DATA_DIR
    process.env.TECDEBT_DATA_DIR = dataDir
    try {
      await mkdir(repository)
      await writeFile(join(repository, 'auth.ts'), 'unsafe()\n')
      for (const args of [
        ['init', '--quiet'],
        ['config', 'user.email', 'test@example.com'],
        ['config', 'user.name', 'CodeTend Test'],
        ['add', 'auth.ts'],
        ['commit', '--quiet', '-m', 'test fixture'],
      ]) {
        const command = Bun.spawnSync(['git', ...args], { cwd: repository })
        expect(command.exitCode).toBe(0)
      }
      const revision = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], {
        cwd: repository,
      })
        .stdout.toString()
        .trim()

      const run = async (
        patchId: number,
        agent: () => Promise<unknown>,
      ): Promise<PatchResult> => {
        const request: PatchRequest = {
          contractVersion: 1,
          executionProfile: { model: 'test-model', effort: 'medium' },
          patchId,
          repositoryId: 91,
          repositoryName: 'offline-fixture',
          repositoryUrl: repository,
          branch: 'main',
          revision,
          finding: {
            id: 17,
            title: 'Unsafe call',
            severity: 'high',
            description: 'The fixture contains an unsafe call.',
            rootCause: null,
            whyItMatters: 'The call should be replaced.',
            recommendation: 'Replace it with safe().',
            locations: [{ path: 'auth.ts', startLine: 1 }],
            codeEvidence: null,
            validationPlan: null,
            remediationTests: null,
            preventiveControls: null,
          },
          validation: {
            enabled: false,
            runner: 'disabled',
            image: 'unused',
          },
        }
        await mkdir(join(dataDir, 'requests'), { recursive: true })
        await writeFile(
          join(dataDir, 'requests', `patch-${patchId}.json`),
          JSON.stringify(request),
        )
        const execution = runFix.execute({ patchId }, { agent } as Parameters<
          typeof runFix.execute
        >[1])
        for await (const _progress of execution) {
          // Exhaust the real workflow generator so its durable steps run.
        }
        return JSON.parse(
          await readFile(
            join(dataDir, 'results', `patch-${patchId}.json`),
            'utf8',
          ),
        ) as PatchResult
      }

      const proposed = await run(1, async () => ({
        outcome: 'patched',
        summary: 'Replaced the unsafe call.',
        diff: [
          'diff --git a/auth.ts b/auth.ts',
          '--- a/auth.ts',
          '+++ b/auth.ts',
          '@@ -1 +1 @@',
          '-unsafe()',
          '+safe()',
          '',
        ].join('\n'),
        changedFiles: ['auth.ts'],
        testRecommendations: ['Run the focused test.'],
      }))
      expect(proposed.status).toBe('proposed')
      expect(proposed.changedFiles).toEqual(['auth.ts'])

      const notReproduced = await run(2, async () => ({
        outcome: 'not_reproduced',
        summary: 'The finding is no longer present.',
        diff: '',
        changedFiles: [],
        testRecommendations: [],
      }))
      expect(notReproduced).toMatchObject({
        status: 'failed',
        error:
          'The fixer could not reproduce the finding in the current revision.',
      })

      const failed = await run(3, async () => {
        throw new Error('agent unavailable')
      })
      expect(failed).toMatchObject({
        status: 'failed',
        summary: 'Patch generation failed.',
        error: 'agent unavailable',
      })
    } finally {
      if (previousDataDir === undefined) delete process.env.TECDEBT_DATA_DIR
      else process.env.TECDEBT_DATA_DIR = previousDataDir
      await rm(root, { recursive: true, force: true })
    }
  })
})
