import { defineAgent } from 'eve'
import { dynamicScannerModel, sessionUsageLimit } from '../../lib/model'

export default defineAgent({
  description:
    'Analyzes one repository for one technical-debt dimension (architecture, duplication, dead code, reliability, ...) and returns structured findings.',
  model: dynamicScannerModel(),
  compaction: { thresholdPercent: 0.8 },
  limits: { sessionUsage: sessionUsageLimit },
})
