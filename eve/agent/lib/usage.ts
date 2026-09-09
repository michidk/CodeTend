import type { HookContext, HookEvent } from 'eve/hooks'
import { usageDir } from './paths'

/**
 * One model call, appended as a JSON line to `usage/<rootSessionId>.jsonl`.
 * The root session id is what the app stores on the scan, so after the scan
 * finishes it can pick up every step of the root turn and of all delegated
 * subagents. `agent` is `root`, `knowledge` or `scanner`; `scannerId` is
 * parsed from the scanner's task message so a step can be attributed to one
 * scanner run.
 */
export interface UsageRecord {
  readonly eventId: string
  readonly sessionId: string
  readonly rootSessionId: string
  readonly turnId: string
  readonly stepIndex: number
  readonly agent: string
  readonly scannerId: string | null
  readonly modelId: string | null
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  readonly costUsd: number | null
  readonly at: string
}

const SCANNER_HEADING = /^# Scanner: .* \(id: ([^)\s]+)\)/m

/**
 * Hook handlers shared by every agent. `step.started` carries the model id
 * and `step.completed` the usage, so the model is remembered per session in
 * memory between the two; after a process restart it falls back to the
 * configured model.
 */
export function usageHooks(agent: string) {
  const models = new Map<string, string>()
  const scanners = new Map<string, string>()
  const clearSession = (sessionId: string) => {
    models.delete(sessionId)
    scanners.delete(sessionId)
  }
  return {
    async 'message.received'(
      event: HookEvent<'message.received'>,
      ctx: HookContext,
    ): Promise<void> {
      const match = SCANNER_HEADING.exec(event.data.message)
      if (match?.[1]) scanners.set(ctx.session.id, match[1])
    },
    async 'step.started'(
      event: HookEvent<'step.started'>,
      ctx: HookContext,
    ): Promise<void> {
      models.set(ctx.session.id, event.data.modelId)
    },
    async 'step.completed'(
      event: HookEvent<'step.completed'>,
      ctx: HookContext,
    ): Promise<void> {
      const usage = event.data.usage
      if (!usage) return
      const record: UsageRecord = {
        eventId: event.meta.id,
        sessionId: ctx.session.id,
        rootSessionId: ctx.session.parent?.rootSessionId ?? ctx.session.id,
        turnId: event.data.turnId,
        stepIndex: event.data.stepIndex,
        agent,
        scannerId: scanners.get(ctx.session.id) ?? null,
        modelId:
          models.get(ctx.session.id) ?? process.env.TECDEBT_MODEL ?? null,
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        cacheReadTokens: usage.cacheReadTokens ?? 0,
        cacheWriteTokens: usage.cacheWriteTokens ?? 0,
        costUsd: usage.costUsd ?? null,
        at: event.meta.at,
      }
      try {
        await appendUsageRecord(record)
      } catch (error) {
        // Usage accounting must never fail a scan.
        console.warn('[tecdebt] failed to record usage', error)
      }
    },
    async 'turn.completed'(
      _event: HookEvent<'turn.completed'>,
      ctx: HookContext,
    ): Promise<void> {
      clearSession(ctx.session.id)
    },
    async 'turn.failed'(
      _event: HookEvent<'turn.failed'>,
      ctx: HookContext,
    ): Promise<void> {
      clearSession(ctx.session.id)
    },
    async 'turn.cancelled'(
      _event: HookEvent<'turn.cancelled'>,
      ctx: HookContext,
    ): Promise<void> {
      clearSession(ctx.session.id)
    },
  }
}

async function appendUsageRecord(record: UsageRecord): Promise<void> {
  const { appendFile, mkdir } = await import('node:fs/promises')
  await mkdir(usageDir(), { recursive: true })
  await appendFile(
    `${usageDir()}/${record.rootSessionId}.jsonl`,
    `${JSON.stringify(record)}\n`,
  )
}
