import { createAnthropic } from '@ai-sdk/anthropic'

/**
 * All agents call Anthropic directly through the AI SDK provider so the
 * runtime does not depend on the Vercel AI Gateway. ANTHROPIC_BASE_URL is
 * optional and allows proxies.
 */
export function anthropicModel() {
  const baseURL = process.env.ANTHROPIC_BASE_URL
  const anthropic = createAnthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseURL: baseURL ? `${baseURL.replace(/\/$/, '')}/v1` : undefined,
  })
  return anthropic(process.env.TECDEBT_MODEL ?? 'claude-sonnet-5')
}

export const MODEL_CONTEXT_WINDOW_TOKENS = 200_000
