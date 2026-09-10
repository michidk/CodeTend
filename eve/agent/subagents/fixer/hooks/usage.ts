import { defineHook } from 'eve/hooks'
import { usageHooks } from '../../../lib/usage'

/** Attribute fixer model steps to the root patch-generation session. */
export default defineHook({ events: usageHooks('fixer') })
