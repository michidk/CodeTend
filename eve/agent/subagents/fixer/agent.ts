import { defineAgent } from 'eve'
import {
  dynamicScannerModel,
  MAX_INPUT_TOKENS_PER_SESSION,
} from '../../lib/model'

export default defineAgent({
  description:
    'Produces a minimal, reviewable unified diff for one accepted security finding without modifying or executing the repository.',
  model: dynamicScannerModel(),
  compaction: { thresholdPercent: 0.8 },
  limits: { maxInputTokensPerSession: MAX_INPUT_TOKENS_PER_SESSION },
})
