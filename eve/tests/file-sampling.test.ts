import { describe, expect, test } from 'bun:test'
import { selectReviewFiles } from '../agent/lib/file-sampling'

const candidate = (path: string, size = 100) => ({ path, size })

describe('file review sampling', () => {
  test('returns every candidate in stable order when the budget fits', () => {
    expect(
      selectReviewFiles({
        candidates: [candidate('src/z.ts'), candidate('src/a.ts')],
        maxFiles: 10,
      }),
    ).toEqual(['src/a.ts', 'src/z.ts'])
  })

  test('prioritizes existing findings and high-signal source over assets', () => {
    const selected = selectReviewFiles({
      candidates: [
        candidate('public/banner.png'),
        candidate('docs/guide.md'),
        candidate('src/auth/session.ts'),
        candidate('src/legacy.ts'),
        candidate('package.json'),
      ],
      maxFiles: 3,
      priorityPaths: ['src/legacy.ts'],
    })
    expect(selected).toEqual([
      'package.json',
      'src/auth/session.ts',
      'src/legacy.ts',
    ])
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
    })
    expect(selected).toEqual(['frontend/index.ts', 'worker/main.go'])
  })
})
