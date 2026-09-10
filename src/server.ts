import {
  createStartHandler,
  defaultStreamHandler,
} from '@tanstack/react-start/server'
import { getServerEnv } from '@/lib/env.server'
import {
  hasValidBasicAuthorization,
  independentlyAuthenticatedPath,
  withSecurityHeaders,
} from '@/lib/http-security'

const startHandler = createStartHandler(defaultStreamHandler)

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const independentlyAuthenticated = independentlyAuthenticatedPath(
      url.pathname,
    )
    if (!independentlyAuthenticated) {
      const env = getServerEnv()
      if (!env.TECDEBT_BASIC_AUTH_PASSWORD) {
        if (process.env.NODE_ENV === 'production') {
          return withSecurityHeaders(
            new Response('Authentication is not configured.', { status: 503 }),
            request,
          )
        }
      } else if (
        !hasValidBasicAuthorization(
          request,
          env.TECDEBT_BASIC_AUTH_USERNAME,
          env.TECDEBT_BASIC_AUTH_PASSWORD,
        )
      ) {
        return withSecurityHeaders(
          new Response('Authentication required.', {
            status: 401,
            headers: {
              'Cache-Control': 'no-store',
              'WWW-Authenticate': 'Basic realm="tecdebt", charset="UTF-8"',
            },
          }),
          request,
        )
      }
    }

    return withSecurityHeaders(await startHandler(request), request)
  },
}
