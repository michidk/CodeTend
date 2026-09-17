import { z } from 'zod'

export const REASONING_EFFORTS = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number]

export const agentExecutionProfileSchema = z.object({
  model: z.string().trim().min(1).max(200),
  effort: z.enum(REASONING_EFFORTS),
})

export type AgentExecutionProfile = z.infer<typeof agentExecutionProfileSchema>

export function resolveExecutionProfile(
  override: Partial<AgentExecutionProfile>,
  fallback: AgentExecutionProfile,
): AgentExecutionProfile {
  return {
    model: override.model?.trim() || fallback.model,
    effort: override.effort ?? fallback.effort,
  }
}

export function availableQueueCapacity(
  maximumConcurrency: number,
  activeCount: number,
): number {
  return Math.max(0, maximumConcurrency - activeCount)
}

const PROFILE_PREFIX = '[codetend-execution-profile]'

/** Carries a persisted job profile into Eve's dynamic model resolver. */
export function executionProfileMarker(profile: AgentExecutionProfile): string {
  return `${PROFILE_PREFIX}${JSON.stringify(profile)}`
}

export function readExecutionProfileMarker(
  value: string,
): AgentExecutionProfile | null {
  const start = value.indexOf(PROFILE_PREFIX)
  if (start < 0) return null
  const line =
    value.slice(start + PROFILE_PREFIX.length).split('\n', 1)[0] ?? ''
  const parsedJson = (() => {
    try {
      return JSON.parse(line) as unknown
    } catch {
      return null
    }
  })()
  const parsed = agentExecutionProfileSchema.safeParse(parsedJson)
  return parsed.success ? parsed.data : null
}
