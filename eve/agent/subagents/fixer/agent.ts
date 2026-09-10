import { defineAgent } from 'eve'
import {
  MAX_INPUT_TOKENS_PER_SESSION,
  MODEL_CONTEXT_WINDOW_TOKENS,
  scannerModel,
} from '../../lib/model'

export default defineAgent({
  description:
    'Produces a minimal, reviewable unified diff for one accepted security finding without modifying or executing the repository.',
  model: scannerModel(),
  modelContextWindowTokens: MODEL_CONTEXT_WINDOW_TOKENS,
  compaction: { thresholdPercent: 0.8 },
  limits: { maxInputTokensPerSession: MAX_INPUT_TOKENS_PER_SESSION },
})
