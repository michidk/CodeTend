import { defineHook } from 'eve/hooks'
import { usageHooks } from '../../../lib/usage'

export default defineHook({ events: usageHooks('knowledge') })
