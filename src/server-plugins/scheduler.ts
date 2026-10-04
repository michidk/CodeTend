import { definePlugin } from 'nitro'
import { ensureScheduler } from '@/lib/server/scheduler.server'

/**
 * Starts the scan scheduler with the server process. Nitro loads the request
 * handler lazily, so without this the scheduler would not tick until the first
 * page load and scheduled slots would silently pile up after every restart.
 */
export default definePlugin(() => {
  ensureScheduler()
})
