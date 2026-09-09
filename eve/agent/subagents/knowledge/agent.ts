import { defineAgent } from 'eve'
import { anthropicModel, MODEL_CONTEXT_WINDOW_TOKENS } from '../../lib/model'

export default defineAgent({
  description:
    'Builds and refreshes persistent, source-grounded knowledge about a repository: overview, architecture, subsystems, domain concepts and workflows.',
  model: anthropicModel(),
  modelContextWindowTokens: MODEL_CONTEXT_WINDOW_TOKENS,
  compaction: { thresholdPercent: 0.8 },
  limits: { maxInputTokensPerSession: false },
})
