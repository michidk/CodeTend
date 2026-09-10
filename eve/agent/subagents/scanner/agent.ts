import { defineAgent } from 'eve'
import { MODEL_CONTEXT_WINDOW_TOKENS, scannerModel } from '../../lib/model'

export default defineAgent({
  description:
    'Analyzes one repository for one technical-debt dimension (architecture, duplication, dead code, reliability, ...) and returns structured findings.',
  model: scannerModel(),
  modelContextWindowTokens: MODEL_CONTEXT_WINDOW_TOKENS,
  compaction: { thresholdPercent: 0.8 },
  limits: { maxInputTokensPerSession: false },
})
