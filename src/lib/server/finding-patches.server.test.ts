import { describe, expect, test } from 'bun:test'
import type { PatchResult } from '@/lib/eve-protocol'
import type { EveScanSession } from '@/lib/server/eve-client.server'
import { waitForPatchSessionResult } from '@/lib/server/finding-patches.server'

const result: PatchResult = {
  patchId: 7,
  status: 'proposed',
  summary: 'Generated a reviewable patch.',
  diff: 'diff --git a/a.ts b/a.ts\n',
  changedFiles: ['a.ts'],
  testRecommendations: [],
  verification: null,
  finishedAt: '2026-09-24T00:00:00.000Z',
}

function session(settle: EveScanSession['settle']): EveScanSession {
  return { sessionId: 'session-7', settle }
}

describe('patch session supervision', () => {
  test('accepts a result file before the Eve stream settles', async () => {
    const received = await waitForPatchSessionResult(
      7,
      session(async () => new Promise(() => {})),
      {
        waitForResult: async () => undefined,
        readResult: async () => result,
        cancelAndDrain: async () => undefined,
      },
    )

    expect(received).toEqual(result)
  })

  test('cancels and drains the Eve session when the deadline fails', async () => {
    const cancelled: string[] = []
    await expect(
      waitForPatchSessionResult(
        7,
        session(async () => new Promise(() => {})),
        {
          waitForResult: async () => {
            throw new Error('deadline reached')
          },
          readResult: async () => null,
          cancelAndDrain: async (sessionId) => {
            cancelled.push(sessionId)
          },
        },
      ),
    ).rejects.toThrow('deadline reached')
    expect(cancelled).toEqual(['session-7'])
  })

  test('gives a completed Eve stream one grace read before failing', async () => {
    let waits = 0
    let reads = 0
    await expect(
      waitForPatchSessionResult(
        7,
        session(async () => ({
          status: 'completed',
          message: undefined,
          failure: undefined,
        })),
        {
          waitForResult: async () => {
            waits += 1
            return undefined
          },
          readResult: async () => {
            reads += 1
            return null
          },
          cancelAndDrain: async () => undefined,
        },
      ),
    ).rejects.toThrow('wrote no patch result')
    expect(waits).toBe(2)
    expect(reads).toBe(2)
  })
})
