import { defineAgent } from 'eve'
import { MODEL_CONTEXT_WINDOW_TOKENS, scannerModel } from '../../lib/model'

export default defineAgent({
  description:
    'Builds and refreshes persistent, source-grounded knowledge about a repository: overview, architecture, subsystems, domain concepts and workflows.',
  model: scannerModel(),
  modelContextWindowTokens: MODEL_CONTEXT_WINDOW_TOKENS,
  compaction: { thresholdPercent: 0.8 },
  limits: { maxInputTokensPerSession: false },
})
