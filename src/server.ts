import {
  createStartHandler,
  defaultStreamHandler,
} from '@tanstack/react-start/server'
import { withSecurityHeaders } from '@/lib/http-security'

const startHandler = createStartHandler(defaultStreamHandler)

/**
 * No authentication gate here: the deployment terminates access control in
 * front of this process (for example a login proxy such as Hodor). Running
 * this app directly reachable without such a gate in front is unsupported.
 */
export default {
  async fetch(request: Request): Promise<Response> {
    return withSecurityHeaders(await startHandler(request), request)
  },
}
