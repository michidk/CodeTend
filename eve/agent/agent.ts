import { defineAgent } from 'eve'
import { MODEL_CONTEXT_WINDOW_TOKENS, scannerModel } from './lib/model'

/**
 * Root orchestrator. It never analyzes code itself: the tecdebt app sends one
 * message per scan and the root calls the durable `run_scan` workflow tool.
 *
 * Eve folds every subagent's usage into the root session, so a per-session
 * token cap here is reached as soon as one or two scanners have run and then
 * fails every remaining scanner at spawn. The cap lives on the knowledge,
 * scanner and fixer agents; the app enforces the per-scan and daily cost caps.
 */
export default defineAgent({
  model: scannerModel(),
  modelContextWindowTokens: MODEL_CONTEXT_WINDOW_TOKENS,
  defaultTools: false,
  limits: {
    maxInputTokensPerSession: false,
    sessionTimeoutMs: 2 * 24 * 60 * 60 * 1_000,
  },
})
