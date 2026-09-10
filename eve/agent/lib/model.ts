import { createOpenAI } from '@ai-sdk/openai'
import { type LanguageModelMiddleware, wrapLanguageModel } from 'ai'

/**
 * Drops reasoning parts from assistant history before each call. Sessions that
 * started on an Anthropic model carry Anthropic reasoning signatures which the
 * OpenAI Responses provider cannot replay; it logged a warning per part on
 * every turn and still sent the surrounding message.
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

/**
 * All agents use an OpenAI-compatible endpoint directly through the AI SDK,
 * without depending on the Vercel AI Gateway. The legacy Anthropic-named
 * variables keep existing local proxy deployments working during migration.
 */
export function scannerModel() {
  const baseURL = process.env.OPENAI_BASE_URL ?? process.env.ANTHROPIC_BASE_URL
  const normalizedBaseURL = baseURL?.replace(/\/$/, '')
  const openai = createOpenAI({
    apiKey: process.env.OPENAI_API_KEY ?? process.env.ANTHROPIC_API_KEY,
    baseURL: normalizedBaseURL
      ? normalizedBaseURL.endsWith('/v1')
        ? normalizedBaseURL
        : `${normalizedBaseURL}/v1`
      : undefined,
  })
  return wrapLanguageModel({
    model: openai.responses(process.env.TECDEBT_MODEL ?? 'gpt-5.6-sol'),
    middleware: stripForeignReasoning,
  })
}

export const MODEL_CONTEXT_WINDOW_TOKENS = 1_050_000

const configuredSessionLimit = Number.parseInt(
  process.env.TECDEBT_MAX_INPUT_TOKENS_PER_SESSION ?? '',
  10,
)

/** Hard cost guardrail for each root, knowledge, or scanner session. */
export const MAX_INPUT_TOKENS_PER_SESSION =
  Number.isFinite(configuredSessionLimit) && configuredSessionLimit >= 10_000
    ? Math.min(configuredSessionLimit, MODEL_CONTEXT_WINDOW_TOKENS)
    : 250_000
