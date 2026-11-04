import '@tanstack/react-start/server-only'

import { Client, type CreatedClientSession } from 'eve/client'
import {
  type AgentExecutionProfile,
  executionProfileMarker,
} from '@/lib/agent-execution'
import { getServerEnv } from '@/lib/env.server'
import type { ScanProgress } from '@/lib/scan-progress'

let cachedClient: Client | undefined

/** Typed client for the Eve agent runtime (see eve/). */
export function getEveClient(): Client {
  if (cachedClient) return cachedClient
  const env = getServerEnv()
  cachedClient = new Client({
    baseUrl: env.EVE_URL,
    auth: env.EVE_PASSWORD
      ? { basic: { username: env.EVE_USERNAME, password: env.EVE_PASSWORD } }
      : undefined,
    redirect: 'error',
  })
  return cachedClient
}

export interface EveHealth {
  readonly ok: boolean
  readonly detail: string
}

export async function checkEveHealth(): Promise<EveHealth> {
  try {
    const health = await getEveClient().health()
    return { ok: health.status === 'ready', detail: health.status }
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    }
  }
}

export interface EveTurnOutcome {
  readonly status: 'completed' | 'failed' | 'waiting'
  readonly message: string | undefined
  readonly failure: string | undefined
}

export interface EveScanSession {
  readonly sessionId: string
  /** Consumes the event stream until the turn settles. */
  readonly settle: (
    onProgress: (progress: ScanProgress) => Promise<void>,
  ) => Promise<EveTurnOutcome>
}

/**
 * Starts a fresh Eve session for a scan. The session id is available at once
 * so the caller can persist it; `settle` streams progress (the workflow tool's
 * partial snapshots become UI phases) until the turn completes or fails.
 */
export async function startEveScanSession(
  scanId: number,
  profile: AgentExecutionProfile,
): Promise<EveScanSession> {
  const client = getEveClient()
  const { delivery } = await client.sessions.create({
    message: `${executionProfileMarker(profile)}\nRun scan ${scanId}.`,
  })
  return responseSession(delivery)
}

export async function startEvePatchSession(
  patchId: number,
  profile: AgentExecutionProfile,
): Promise<EveScanSession> {
  const client = getEveClient()
  const { delivery } = await client.sessions.create({
    message: `${executionProfileMarker(profile)}\nGenerate patch ${patchId}.`,
  })
  return responseSession(delivery)
}

/** Cooperatively cancels the active Eve turn and every task it spawned. */
export async function cancelEveScanSession(
  sessionId: string,
): Promise<'accepted' | 'no_active_turn'> {
  await getEveClient().sessions.attach(sessionId).cancel()
  return 'accepted'
}

/** Cancels a durable Eve turn and gives its stream a bounded drain window. */
export async function cancelAndDrainEveSession(
  sessionId: string,
  settlement: Promise<unknown>,
  options: {
    readonly timeoutMs?: number
    readonly cancel?: typeof cancelEveScanSession
  } = {},
): Promise<void> {
  const cancel = options.cancel ?? cancelEveScanSession
  await cancel(sessionId).catch((error) =>
    console.warn(
      `[CodeTend] Eve cancellation request failed for session ${sessionId}`,
      error,
    ),
  )
  const timeoutMs = options.timeoutMs ?? 30_000
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    settlement.catch(() => undefined),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs)
    }),
  ])
  if (timer) clearTimeout(timer)
}

export function responseSession(
  delivery: CreatedClientSession['delivery'],
): EveScanSession {
  return {
    sessionId: delivery.sessionId,
    settle: async (onProgress) => {
      let lastProgress: string | undefined
      for await (const event of delivery.stream()) {
        if (event.type !== 'call.progress') continue
        const output = readPartialOutput(event.data.output)
        const serialized = output ? JSON.stringify(output) : undefined
        if (output && serialized !== lastProgress) {
          lastProgress = serialized
          await onProgress(output)
        }
      }

      const result = await delivery.result()
      switch (result.status) {
        case 'completed':
          return {
            status: 'completed',
            message: result.reply,
            failure: undefined,
          }
        case 'failed':
          return {
            status: 'failed',
            message: result.reply,
            failure: [result.error.code, result.error.message]
              .filter(Boolean)
              .join(': '),
          }
        case 'cancelled':
          return {
            status: 'failed',
            message: result.reply,
            failure: 'The Eve turn was cancelled.',
          }
        case 'awaiting-input':
          return {
            status: 'failed',
            message: result.reply,
            failure: `Eve paused the session for operator input: ${result.interactions.map((interaction) => interaction.request.prompt).join('; ') || 'operator approval is required'}`,
          }
      }
    },
  }
}

function readPartialOutput(data: unknown): ScanProgress | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const candidate = data
  if (
    !('phase' in candidate) ||
    !('completed' in candidate) ||
    !('total' in candidate)
  )
    return undefined
  if (
    typeof candidate.phase !== 'string' ||
    typeof candidate.completed !== 'number' ||
    typeof candidate.total !== 'number'
  ) {
    return undefined
  }
  return {
    phase: candidate.phase,
    completed: candidate.completed,
    total: candidate.total,
    ...('detail' in candidate && typeof candidate.detail === 'string'
      ? { detail: candidate.detail }
      : {}),
    ...('scannerCompleted' in candidate &&
    typeof candidate.scannerCompleted === 'number'
      ? { scannerCompleted: candidate.scannerCompleted }
      : {}),
    ...('scannerTotal' in candidate &&
    typeof candidate.scannerTotal === 'number'
      ? { scannerTotal: candidate.scannerTotal }
      : {}),
    ...('targetFileCount' in candidate &&
    typeof candidate.targetFileCount === 'number'
      ? { targetFileCount: candidate.targetFileCount }
      : {}),
  }
}
