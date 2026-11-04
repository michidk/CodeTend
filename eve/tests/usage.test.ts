import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { usageHooks } from '../agent/lib/usage'

type UsageContext = Parameters<
  ReturnType<typeof usageHooks>['model.started']
>[1]

function hookContext(turnId = 'scanner-turn'): UsageContext {
  return {
    now: new Date('2026-09-09T00:00:00.000Z'),
    turn: { id: turnId, status: 'running', input: [] },
    session: {
      id: 'scanner-session',
      auth: { current: null, initiator: null },
      parent: {
        callId: 'call-1',
        rootSessionId: 'root-session',
        sessionId: 'root-session',
        turn: { id: 'root-turn', sequence: 0 },
      },
    },
  }
}

describe('Eve usage hooks', () => {
  test('records child usage against the root scan and clears turn state', async () => {
    const temporaryData = await mkdtemp(join(tmpdir(), 'codetend-usage-'))
    const previousDataDir = process.env.TECDEBT_DATA_DIR
    const previousModel = process.env.TECDEBT_MODEL
    process.env.TECDEBT_DATA_DIR = temporaryData
    process.env.TECDEBT_MODEL = 'fallback-model'

    try {
      const hooks = usageHooks('scanner')
      const context = hookContext()
      await hooks['delivery.consumed'](
        {
          type: 'delivery.consumed',
          data: {
            deliveryId: 'delivery-1',
            turnId: 'scanner-turn',
            parts: [
              {
                kind: 'text',
                text: '# Scanner: Security Hygiene (id: security)',
              },
            ],
          },
        },
        context,
      )
      await hooks['model.started'](
        {
          type: 'model.started',
          data: { modelId: 'claude-sonnet-5', runId: 'run-1', attempt: 0 },
        },
        context,
      )
      await hooks['model.settled'](
        {
          type: 'model.settled',
          data: { runId: 'run-1', outcome: 'completed', finishReason: 'stop' },
        },
        context,
      )
      await hooks['usage.recorded'](
        {
          type: 'usage.recorded',
          data: {
            kind: 'model',
            owner: { runId: 'run-1' },
            usage: {
              inputTokens: 120,
              outputTokens: 30,
              cacheReadTokens: 20,
              cacheWriteTokens: 10,
            },
          },
        },
        context,
      )
      await hooks['turn.settled'](
        {
          type: 'turn.settled',
          data: { turnId: 'scanner-turn', outcome: 'completed' },
        },
        context,
      )
      const next = hookContext('next-turn')
      await hooks['model.settled'](
        {
          type: 'model.settled',
          data: { runId: 'run-2', outcome: 'completed', finishReason: 'stop' },
        },
        next,
      )
      await hooks['usage.recorded'](
        {
          type: 'usage.recorded',
          data: {
            kind: 'model',
            owner: { runId: 'run-2' },
            usage: {
              inputTokens: 1,
              outputTokens: 1,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
            },
          },
        },
        next,
      )
      await hooks['model.settled'](
        {
          type: 'model.settled',
          data: {
            runId: 'refused',
            outcome: 'completed',
            finishReason: 'content-filter',
          },
        },
        next,
      )
      await hooks['model.settled'](
        {
          type: 'model.settled',
          data: { runId: 'empty', outcome: 'completed', finishReason: 'stop' },
        },
        next,
      )
      await hooks['turn.settled'](
        {
          type: 'turn.settled',
          data: { turnId: 'next-turn', outcome: 'completed' },
        },
        next,
      )

      const rows = (
        await readFile(
          join(temporaryData, 'usage', 'root-session.jsonl'),
          'utf8',
        )
      )
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))

      expect(rows).toHaveLength(3)
      expect(rows[0]).toMatchObject({
        eventId: 'scanner-session:run-1',
        rootSessionId: 'root-session',
        scannerId: 'security',
        modelId: 'claude-sonnet-5',
        inputTokens: 120,
        outputTokens: 30,
        cacheReadTokens: 20,
        cacheWriteTokens: 10,
        finishReason: 'stop',
      })
      expect(rows[1]).toMatchObject({
        scannerId: null,
        modelId: 'fallback-model',
      })
      expect(rows[2]).toMatchObject({
        eventId: 'scanner-session:refused',
        finishReason: 'content-filter',
        inputTokens: 0,
        outputTokens: 0,
      })
    } finally {
      if (previousDataDir === undefined) delete process.env.TECDEBT_DATA_DIR
      else process.env.TECDEBT_DATA_DIR = previousDataDir
      if (previousModel === undefined) delete process.env.TECDEBT_MODEL
      else process.env.TECDEBT_MODEL = previousModel
      await rm(temporaryData, { recursive: true, force: true })
    }
  })
})
