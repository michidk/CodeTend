import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { HookContext } from 'eve/hooks'
import { usageHooks } from '../agent/lib/usage'

function hookContext(turnId = 'scanner-turn'): HookContext {
  return {
    agent: { name: 'scanner' },
    channel: { kind: 'subagent' },
    session: {
      id: 'scanner-session',
      auth: { current: null, initiator: null },
      turn: { id: turnId, sequence: 0 },
      parent: {
        callId: 'call-1',
        rootSessionId: 'root-session',
        sessionId: 'root-session',
        turn: { id: 'root-turn', sequence: 0 },
      },
    },
    async getSandbox() {
      throw new Error('not used by this hook')
    },
    getSkill() {
      throw new Error('not used by this hook')
    },
  }
}

const meta = (id: string) => ({ id, at: '2026-09-09T00:00:00.000Z' })

describe('Eve usage hooks', () => {
  test('records child usage against the root scan and clears turn state', async () => {
    const temporaryData = await mkdtemp(join(tmpdir(), 'tecdebt-usage-'))
    const previousDataDir = process.env.TECDEBT_DATA_DIR
    const previousModel = process.env.TECDEBT_MODEL
    process.env.TECDEBT_DATA_DIR = temporaryData
    process.env.TECDEBT_MODEL = 'fallback-model'

    try {
      const hooks = usageHooks('scanner')
      const context = hookContext()
      await hooks['message.received'](
        {
          type: 'message.received',
          data: {
            message: '# Scanner: Security Hygiene (id: security)',
            sequence: 0,
            turnId: 'scanner-turn',
          },
          meta: meta('message-event'),
        },
        context,
      )
      await hooks['step.started'](
        {
          type: 'step.started',
          data: {
            modelId: 'claude-sonnet-5',
            sequence: 1,
            stepIndex: 0,
            turnId: 'scanner-turn',
          },
          meta: meta('started-event'),
        },
        context,
      )
      await hooks['step.completed'](
        {
          type: 'step.completed',
          data: {
            finishReason: 'stop',
            sequence: 2,
            stepIndex: 0,
            turnId: 'scanner-turn',
            usage: {
              inputTokens: 120,
              outputTokens: 30,
              cacheReadTokens: 20,
              cacheWriteTokens: 10,
            },
          },
          meta: meta('completed-event'),
        },
        context,
      )
      await hooks['turn.completed'](
        {
          type: 'turn.completed',
          data: { sequence: 3, turnId: 'scanner-turn' },
          meta: meta('turn-event'),
        },
        context,
      )

      await hooks['step.completed'](
        {
          type: 'step.completed',
          data: {
            finishReason: 'stop',
            sequence: 1,
            stepIndex: 0,
            turnId: 'next-turn',
            usage: { inputTokens: 1, outputTokens: 1 },
          },
          meta: meta('next-completed-event'),
        },
        hookContext('next-turn'),
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

      expect(rows).toHaveLength(2)
      expect(rows[0]).toMatchObject({
        eventId: 'completed-event',
        rootSessionId: 'root-session',
        scannerId: 'security',
        modelId: 'claude-sonnet-5',
        inputTokens: 120,
        outputTokens: 30,
        cacheReadTokens: 20,
        cacheWriteTokens: 10,
      })
      expect(rows[1]).toMatchObject({
        scannerId: null,
        modelId: 'fallback-model',
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
