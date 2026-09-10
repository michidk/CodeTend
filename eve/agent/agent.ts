import { defineAgent } from 'eve'
import {
  MAX_INPUT_TOKENS_PER_SESSION,
  MODEL_CONTEXT_WINDOW_TOKENS,
  scannerModel,
} from './lib/model'

/**
 * Root orchestrator. It never analyzes code itself: the tecdebt app sends one
 * message per scan and the root calls the durable `run_scan` workflow tool.
 */
export default defineAgent({
  model: scannerModel(),
  modelContextWindowTokens: MODEL_CONTEXT_WINDOW_TOKENS,
  defaultTools: false,
  limits: {
    maxInputTokensPerSession: MAX_INPUT_TOKENS_PER_SESSION,
    sessionTimeoutMs: 2 * 24 * 60 * 60 * 1_000,
  },
})
