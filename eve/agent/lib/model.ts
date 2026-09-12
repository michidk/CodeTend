import { createOpenAI } from '@ai-sdk/openai'
import { type LanguageModelMiddleware, wrapLanguageModel } from 'ai'

/**
 * Drops reasoning parts from assistant history before each call. A durable
 * session that started on one model may resume on another after the operator
 * changes `TECDEBT_MODEL`; reasoning items carry provider-specific signatures
 * that the new model cannot replay.
 */
export const stripForeignReasoning: LanguageModelMiddleware = {
  transformParams: async ({ params }) => ({
    ...params,
    prompt: params.prompt.map((message) =>
      message.role === 'assistant'
        ? {
            ...message,
            content: message.content.filter(
              (part) => part.type !== 'reasoning',
            ),
          }
        : message,
    ),
  }),
}

export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

const REASONING_EFFORTS: readonly ReasoningEffort[] = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]

export const DEFAULT_MODEL = 'gpt-5.6-sol'

export interface ModelSettings {
  readonly modelId: string
  readonly reasoningEffort: ReasoningEffort
}

/**
 * Reads the model and reasoning effort from the environment. The endpoint is
 * OpenAI-compatible, so `TECDEBT_MODEL` may be a native OpenAI id or a
 * gateway id such as `anthropic/claude-opus-5` through OpenRouter. Effort is
 * the only knob that differs per model family: OpenAI recommends `medium` as
 * the balanced default for GPT-5.6, while Anthropic recommends `high` or
 * above for agentic coding work on Claude.
 */
export function resolveModelSettings(
  env: NodeJS.ProcessEnv = process.env,
): ModelSettings {
  const modelId = env.TECDEBT_MODEL?.trim() || DEFAULT_MODEL
  const configured = env.TECDEBT_EFFORT?.trim().toLowerCase()
  const reasoningEffort = REASONING_EFFORTS.includes(
    configured as ReasoningEffort,
  )
    ? (configured as ReasoningEffort)
    : defaultEffort(modelId)
  return { modelId, reasoningEffort }
}

function defaultEffort(modelId: string): ReasoningEffort {
  return /claude/i.test(modelId) ? 'high' : 'medium'
}

/** Mirrors the AI SDK's own detection of natively reasoning OpenAI ids. */
function isNativeOpenAIReasoningModel(modelId: string): boolean {
  if (/^o\d+(?:-|$)/.test(modelId)) return true
  const gpt = /^gpt-(\d+)(?:\.(\d+))?(?:-(.+))?$/.exec(modelId)
  if (!gpt) return false
  const major = Number(gpt[1])
  const isChatModel =
    gpt[2] === undefined && (gpt[3]?.startsWith('chat') ?? false)
  return major >= 5 && !isChatModel
}

/**
 * Injects the per-call provider options every agent shares. Scanner output is
 * schema-constrained, so low text verbosity only trims free-text padding.
 * `forceReasoning` makes the provider send `reasoning.effort` for ids it does
 * not recognise as reasoning models (gateway ids like `anthropic/...`); the
 * system role stays `system` there because forcing reasoning would otherwise
 * switch it to OpenAI's `developer` role, which gateways may not accept.
 */
export function modelSettingsMiddleware(
  settings: ModelSettings,
): LanguageModelMiddleware {
  const openai: Record<string, string | boolean> = {
    reasoningEffort: settings.reasoningEffort,
    textVerbosity: 'low',
  }
  if (!isNativeOpenAIReasoningModel(settings.modelId)) {
    openai.forceReasoning = true
    openai.systemMessageMode = 'system'
  }
  return {
    transformParams: async ({ params }) => ({
      ...params,
      providerOptions: {
        ...params.providerOptions,
        openai: { ...openai, ...params.providerOptions?.openai },
      },
    }),
  }
}

/**
 * All agents talk to one OpenAI-compatible endpoint through the AI SDK,
 * without depending on the Vercel AI Gateway. `OPENAI_BASE_URL` may point at
 * OpenAI, a proxy or a gateway such as OpenRouter that serves other vendors'
 * models behind the same API.
 */
export function scannerModel() {
  const baseURL = process.env.OPENAI_BASE_URL?.trim().replace(/\/$/, '')
  const openai = createOpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: baseURL
      ? baseURL.endsWith('/v1')
        ? baseURL
        : `${baseURL}/v1`
      : undefined,
  })
  const settings = resolveModelSettings()
  return wrapLanguageModel({
    model: openai.responses(settings.modelId),
    middleware: [stripForeignReasoning, modelSettingsMiddleware(settings)],
  })
}

const configuredContextWindow = Number.parseInt(
  process.env.TECDEBT_MODEL_CONTEXT_WINDOW_TOKENS ?? '',
  10,
)

/** Context window of the configured model; 1M covers GPT-5.6 and Claude 5. */
export const MODEL_CONTEXT_WINDOW_TOKENS =
  Number.isFinite(configuredContextWindow) && configuredContextWindow >= 32_000
    ? configuredContextWindow
    : 1_050_000

const configuredSessionLimit = Number.parseInt(
  process.env.TECDEBT_MAX_INPUT_TOKENS_PER_SESSION ?? '',
  10,
)

/**
 * Optional guardrail for each knowledge, scanner or fixer session, counted as
 * the sum of input tokens over every model step (cache reads included), so a
 * scanner that re-reads a 50k-token context for ten steps has used 500k. Off
 * unless configured: a session that hits the cap does not fail, it parks the
 * whole scan waiting for an operator to approve more budget. Cost is bounded
 * by the app's per-scan and daily USD caps instead.
 */
export const MAX_INPUT_TOKENS_PER_SESSION: number | false =
  Number.isFinite(configuredSessionLimit) && configuredSessionLimit >= 10_000
    ? configuredSessionLimit
    : false
