import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_SCAN_FILE_GLOB,
  selectReviewFiles,
} from '../agent/lib/file-sampling'

const candidate = (path: string, size = 100) => ({ path, size })

describe('file review sampling', () => {
  test('returns every candidate in stable order when the budget fits', () => {
    expect(
      selectReviewFiles({
        candidates: [candidate('src/z.ts'), candidate('src/a.ts')],
        maxFiles: 10,
        fileGlob: DEFAULT_SCAN_FILE_GLOB,
      }),
    ).toEqual(['src/a.ts', 'src/z.ts'])
  })

  test('prioritizes existing findings and security-sensitive source', () => {
    const selected = selectReviewFiles({
      candidates: [
        candidate('public/banner.png'),
        candidate('docs/guide.md'),
        candidate('src/auth/session.ts'),
        candidate('src/legacy.ts'),
        candidate('src/render.tsx'),
        candidate('package.json'),
      ],
      maxFiles: 2,
      fileGlob: DEFAULT_SCAN_FILE_GLOB,
      priorityPaths: ['src/legacy.ts'],
    })
    expect(selected).toEqual(['src/auth/session.ts', 'src/legacy.ts'])
  })

  test('filters candidates with the configured extension glob', () => {
    const selected = selectReviewFiles({
      candidates: [
        candidate('package.json'),
        candidate('docs/guide.md'),
        candidate('src/app.ts'),
        candidate('worker/main.go'),
        candidate('worker/main.py'),
      ],
      maxFiles: 10,
      fileGlob: '**/*.{go,py}',
    })

    expect(selected).toEqual(['worker/main.go', 'worker/main.py'])
  })

  test('seeds useful files from separate top-level areas', () => {
    const selected = selectReviewFiles({
      candidates: [
        candidate('frontend/index.ts'),
        candidate('frontend/router.ts'),
        candidate('worker/main.go'),
        candidate('worker/queue.go'),
      ],
      maxFiles: 2,
      fileGlob: DEFAULT_SCAN_FILE_GLOB,
    })
    expect(selected).toEqual(['frontend/index.ts', 'worker/main.go'])
  })
})
