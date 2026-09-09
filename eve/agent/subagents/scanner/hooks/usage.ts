import { defineHook } from 'eve/hooks'
import { usageHooks } from '../../../lib/usage'

/** Subagent hooks fire only inside the scanner scope, so each agent has one. */
export default defineHook({ events: usageHooks('scanner') })
