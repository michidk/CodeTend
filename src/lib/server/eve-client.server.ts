import '@tanstack/react-start/server-only'

import { Client } from 'eve/client'
import { getServerEnv } from '@/lib/env.server'

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
  readonly sessionId: string
  readonly status: 'completed' | 'failed' | 'waiting'
  readonly message: string | undefined
  readonly failure: string | undefined
}

/**
 * Starts a fresh Eve session for a scan and waits for the turn to settle.
 * Progress is reported through `onPhase` from the workflow tool's partial
 * snapshots so the UI can show which pipeline step is running.
 */
export async function runEveScanSession(
  scanId: number,
  onPhase: (phase: string) => Promise<void>,
): Promise<EveTurnOutcome> {
  const client = getEveClient()
  const { response } = await client.sessions.create({
    message: `Run scan ${scanId}.`,
  })

  let message: string | undefined
  let failure: string | undefined
  let status: EveTurnOutcome['status'] = 'waiting'
  let lastPhase: string | undefined

  for await (const event of response) {
    switch (event.type) {
      case 'action.partial': {
        const output = readPartialOutput(event.data)
        if (output?.phase && output.phase !== lastPhase) {
          lastPhase = output.phase
          await onPhase(output.phase)
        }
        break
      }
      case 'message.completed': {
        const data = event.data as { message?: string | null }
        if (typeof data.message === 'string') message = data.message
        break
      }
      case 'turn.completed':
        status = 'completed'
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

  return { sessionId: response.sessionId, status, message, failure }
}

function readPartialOutput(data: unknown): { phase?: string } | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const result = (data as { result?: { output?: unknown } }).result
  const output = result?.output
  if (typeof output !== 'object' || output === null) return undefined
  const phase = (output as { phase?: unknown }).phase
  return typeof phase === 'string' ? { phase } : undefined
}
