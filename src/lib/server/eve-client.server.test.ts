import { describe, expect, test } from 'bun:test'
import { cancelAndDrainEveSession } from './eve-client.server'

describe('cancelAndDrainEveSession', () => {
  test('requests cancellation and drains a settled stream', async () => {
    const calls: string[] = []
    await cancelAndDrainEveSession('session-1', Promise.resolve(), {
      cancel: async (sessionId) => {
        calls.push(sessionId)
        return 'accepted'
      },
      timeoutMs: 50,
    })

    expect(calls).toEqual(['session-1'])
  })

  test('does not wait indefinitely for a stream that never settles', async () => {
    const startedAt = Date.now()
    await cancelAndDrainEveSession('session-2', new Promise(() => {}), {
      cancel: async () => 'no_active_turn',
      timeoutMs: 5,
    })

    expect(Date.now() - startedAt).toBeLessThan(1_000)
  })
})
