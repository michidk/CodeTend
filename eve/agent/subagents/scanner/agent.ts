import { defineAgent } from 'eve'
import {
  dynamicScannerModel,
  MAX_INPUT_TOKENS_PER_SESSION,
} from '../../lib/model'

export default defineAgent({
  description:
    'Analyzes one repository for one technical-debt dimension (architecture, duplication, dead code, reliability, ...) and returns structured findings.',
  model: dynamicScannerModel(),
  compaction: { thresholdPercent: 0.8 },
  limits: { maxInputTokensPerSession: MAX_INPUT_TOKENS_PER_SESSION },
})
