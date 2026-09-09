import { defineHook } from 'eve/hooks'
import { usageHooks } from '../lib/usage'

/** Records token usage of the root orchestrator's own model steps. */
export default defineHook({ events: usageHooks('root') })
