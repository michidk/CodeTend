import '@tanstack/react-start/server-only'

import { Client } from 'eve/client'
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
    host: env.EVE_URL,
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
  const { response } = await client.sessions.create({
    message: `${executionProfileMarker(profile)}\nRun scan ${scanId}.`,
  })
  return responseSession(response)
}

export async function startEvePatchSession(
  patchId: number,
  profile: AgentExecutionProfile,
): Promise<EveScanSession> {
  const client = getEveClient()
  const { response } = await client.sessions.create({
    message: `${executionProfileMarker(profile)}\nGenerate patch ${patchId}.`,
  })
  return responseSession(response)
}

/** Cooperatively cancels the active Eve turn and every task it spawned. */
export async function cancelEveScanSession(
  sessionId: string,
): Promise<'accepted' | 'no_active_turn'> {
  const result = await getEveClient()
    .sessions.attach(sessionId)
    .cancel({ tasks: true })
  return result.status
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

interface StreamResponse
  extends AsyncIterable<{ readonly type: string; readonly data?: unknown }> {
  readonly sessionId: string
}

function responseSession(response: StreamResponse): EveScanSession {
  return {
    sessionId: response.sessionId,
    settle: async (onProgress) => {
      let message: string | undefined
      let failure: string | undefined
      let status: EveTurnOutcome['status'] = 'waiting'
      let lastProgress: string | undefined

      for await (const event of response) {
        switch (event.type) {
          case 'action.partial': {
            const output = readPartialOutput(event.data)
            const serialized = output ? JSON.stringify(output) : undefined
            if (output && serialized !== lastProgress) {
              lastProgress = serialized
              await onProgress(output)
            }
            break
          }
          case 'message.completed': {
            const data = event.data as { message?: string | null }
            if (typeof data.message === 'string') message = data.message
            break
          }
          case 'input.requested': {
            // A session that hits a configured usage limit does not fail: Eve
            // parks it on an approval prompt and completes the turn without a
            // result. Nothing in CodeTend answers prompts, so treat it as a
            // failure now instead of waiting for the scan timeout.
            const parked = readParkedRequest(event.data)
            if (parked) {
              status = 'failed'
              failure = parked
            }
            break
          }
          case 'turn.completed':
            if (status !== 'failed') status = 'completed'
            break
          case 'turn.failed':
          case 'session.failed': {
            const data = event.data as { code?: string; message?: string }
            status = 'failed'
            failure = [data.code, data.message].filter(Boolean).join(': ')
            break
          }
          case 'turn.cancelled':
            status = 'failed'
            failure = 'The Eve turn was cancelled.'
            break
          default:
            break
        }
      }

      return { status, message, failure }
    },
  }
}

function readParkedRequest(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const requests = (data as { requests?: unknown }).requests
  if (!Array.isArray(requests)) return undefined
  for (const request of requests) {
    if (typeof request !== 'object' || request === null) continue
    const { kind, prompt } = request as { kind?: unknown; prompt?: unknown }
    if (kind === 'session-limit') {
      return `Eve paused the session for operator approval: ${
        typeof prompt === 'string'
          ? prompt
          : 'a session usage limit was reached'
      } Raise or unset TECDEBT_MAX_INPUT_TOKENS_PER_SESSION.`
    }
  }
  return undefined
}

function readPartialOutput(data: unknown): ScanProgress | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const result = (data as { result?: { output?: unknown } }).result
  const output = result?.output
  if (typeof output !== 'object' || output === null) return undefined
  const candidate = output as Record<string, unknown>
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
    ...(typeof candidate.detail === 'string'
      ? { detail: candidate.detail }
      : {}),
    ...(typeof candidate.scannerCompleted === 'number'
      ? { scannerCompleted: candidate.scannerCompleted }
      : {}),
    ...(typeof candidate.scannerTotal === 'number'
      ? { scannerTotal: candidate.scannerTotal }
      : {}),
    ...(typeof candidate.targetFileCount === 'number'
      ? { targetFileCount: candidate.targetFileCount }
      : {}),
  }
}
