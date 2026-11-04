import type { HookContext, HookEvent } from 'eve/hooks'
import { resolveModelSettings } from './model'
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
  /** Provider finish reason; `content-filter` marks a safety-classifier refusal. */
  readonly finishReason: string
  readonly at: string
}

type UsageContext = Pick<HookContext, 'session' | 'turn' | 'now'>

const SCANNER_HEADING = /^# Scanner: .* \(id: ([^)\s]+)\)/m

/** Records model usage and refusal outcomes from Eve's durable run events. */
export function usageHooks(agent: string) {
  const runs = new Map<
    string,
    {
      modelId: string
      stepIndex: number
      finishReason?: string
      recorded?: boolean
    }
  >()
  const scanners = new Map<string, string>()
  const steps = new Map<string, number>()
  const runKey = (ctx: UsageContext, runId: string) =>
    `${ctx.session.id}:${runId}`
  const record = async (
    ctx: UsageContext,
    runId: string,
    usage?: HookEvent<'usage.recorded'>['data']['usage'],
  ) => {
    const run = runs.get(runKey(ctx, runId))
    const row: UsageRecord = {
      eventId: `${ctx.session.id}:${runId}`,
      sessionId: ctx.session.id,
      rootSessionId: ctx.session.parent?.rootSessionId ?? ctx.session.id,
      turnId: ctx.turn?.id ?? '',
      stepIndex: run?.stepIndex ?? 0,
      agent,
      scannerId: scanners.get(ctx.session.id) ?? null,
      modelId: run?.modelId ?? resolveModelSettings().modelId,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      cacheReadTokens: usage?.cacheReadTokens ?? 0,
      cacheWriteTokens: usage?.cacheWriteTokens ?? 0,
      costUsd: usage?.costUsd ?? null,
      finishReason: run?.finishReason ?? 'unknown',
      at: ctx.now.toISOString(),
    }
    try {
      await appendUsageRecord(row)
      if (run) run.recorded = true
    } catch (error) {
      console.warn('[CodeTend] failed to record usage', error)
    }
  }
  return {
    async 'delivery.consumed'(
      event: HookEvent<'delivery.consumed'>,
      ctx: UsageContext,
    ) {
      const message = event.data.parts
        .flatMap((part) => (part.kind === 'text' ? [part.text] : []))
        .join('\n')
      const match = SCANNER_HEADING.exec(message)
      if (match?.[1]) scanners.set(ctx.session.id, match[1])
    },
    async 'model.started'(
      event: HookEvent<'model.started'>,
      ctx: UsageContext,
    ) {
      const key = runKey(ctx, event.data.runId)
      const existing = runs.get(key)
      if (existing) {
        existing.modelId = event.data.modelId
        return
      }
      const stepIndex = steps.get(ctx.session.id) ?? 0
      runs.set(key, { modelId: event.data.modelId, stepIndex })
      steps.set(ctx.session.id, stepIndex + 1)
    },
    async 'model.settled'(
      event: HookEvent<'model.settled'>,
      ctx: UsageContext,
    ) {
      const key = runKey(ctx, event.data.runId)
      const run = runs.get(key) ?? {
        modelId: resolveModelSettings().modelId,
        stepIndex: 0,
      }
      run.finishReason = event.data.finishReason
      runs.set(key, run)
    },
    async 'usage.recorded'(
      event: HookEvent<'usage.recorded'>,
      ctx: UsageContext,
    ) {
      const owner = event.data.owner
      if (event.data.kind !== 'model' || !owner || !('runId' in owner)) return
      await record(ctx, owner.runId, event.data.usage)
    },
    async 'turn.settled'(_event: HookEvent<'turn.settled'>, ctx: UsageContext) {
      const prefix = `${ctx.session.id}:`
      for (const [key, run] of runs) {
        if (!key.startsWith(prefix)) continue
        if (!run.recorded && run.finishReason === 'content-filter')
          await record(ctx, key.slice(prefix.length))
        runs.delete(key)
      }
      scanners.delete(ctx.session.id)
      steps.delete(ctx.session.id)
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
