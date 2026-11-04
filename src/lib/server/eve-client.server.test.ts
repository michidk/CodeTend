import { describe, expect, test } from 'bun:test'
import type { SessionStreamEvent } from 'eve/client'
import { cancelAndDrainEveSession, responseSession } from './eve-client.server'

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

type EveDelivery = Parameters<typeof responseSession>[0]
type DeliveryResult = Awaited<ReturnType<EveDelivery['result']>>

function deliveryWithResult(
  result: DeliveryResult,
  events: SessionStreamEvent[] = [],
): EveDelivery {
  return {
    sessionId: result.sessionId,
    deliveryId: result.deliveryId,
    async *stream() {
      yield* events
    },
    async result() {
      return result
    },
  }
}

const completedResult: DeliveryResult = {
  sessionId: 'session-1',
  deliveryId: 'delivery-1',
  status: 'completed',
  outcome: 'handled',
  reply: 'Scan finished',
  data: undefined,
  sessionEnded: false,
  interactions: [],
}

describe('Eve delivery adaptation', () => {
  test('reports progress once and takes completion and reply from the delivery', async () => {
    const progress = { phase: 'analyzing', completed: 1, total: 2 }
    const event: SessionStreamEvent = {
      type: 'call.progress',
      data: { callId: 'call-1', output: progress },
      meta: { at: '2026-11-01T00:00:00Z', position: { line: 1, index: 0 } },
    }
    const session = responseSession(
      deliveryWithResult(completedResult, [event, event]),
    )
    const updates: unknown[] = []
    expect(session.sessionId).toBe('session-1')
    expect(
      await session.settle(async (value) => {
        updates.push(value)
      }),
    ).toEqual({
      status: 'completed',
      message: 'Scan finished',
      failure: undefined,
    })
    expect(updates).toEqual([progress])
  })

  test('surfaces failures and cancellation instead of completing a scan', async () => {
    for (const result of [
      {
        ...completedResult,
        status: 'failed',
        outcome: 'failed',
        error: { code: 'MODEL_FAILED', message: 'Provider unavailable' },
      },
      { ...completedResult, status: 'cancelled' },
    ] satisfies DeliveryResult[]) {
      const outcome = await responseSession(deliveryWithResult(result)).settle(
        async () => {},
      )
      expect(outcome.status).toBe('failed')
      expect(outcome.failure).toContain(
        result.status === 'failed' ? 'Provider unavailable' : 'cancelled',
      )
    }
  })

  test('fails promptly when a scan needs operator input', async () => {
    const result: DeliveryResult = {
      ...completedResult,
      status: 'awaiting-input',
      outcome: 'awaiting-input',
      interactions: [
        {
          interactionId: 'budget',
          turnId: 'turn-1',
          stepIndex: 0,
          status: 'open',
          request: { kind: 'budget', prompt: 'Increase the token limit' },
        },
      ],
    }
    const outcome = await responseSession(deliveryWithResult(result)).settle(
      async () => {},
    )
    expect(outcome.status).toBe('failed')
    expect(outcome.failure).toContain('Increase the token limit')
  })
})
