import { defineAgent } from 'eve'
import { dynamicScannerModel, sessionUsageLimit } from '../../lib/model'

export default defineAgent({
  description:
    'Builds and refreshes persistent, source-grounded knowledge about a repository: overview, architecture, subsystems, domain concepts and workflows.',
  model: dynamicScannerModel(),
  compaction: { thresholdPercent: 0.8 },
  limits: { sessionUsage: sessionUsageLimit },
})
