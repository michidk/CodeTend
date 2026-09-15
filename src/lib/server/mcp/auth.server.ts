import '@tanstack/react-start/server-only'

import { createHmac } from 'node:crypto'
import {
  OAuthError,
  OAuthErrorCode,
  type OAuthTokenVerifier,
} from '@modelcontextprotocol/server'
import { jwtVerify } from 'jose'
import type { McpConfig } from './config.server'
import type { OAuthStore } from './oauth-store.server'

function derivedSigningKey(secret: string) {
  return createHmac('sha256', secret)
    .update('codetend:mcp-oauth:access-token:v1')
    .digest()
}

export function getOAuthSigningKey(secret: string) {
  return derivedSigningKey(secret)
}

// Hodor reports how it admitted each request it proxies. Reading that is what
// the header is for: its session cookie is an internal format, and re-deriving
// the HMAC here left a client admitted by BYPASS_CIDRS — which never receives a
// cookie — indistinguishable from an anonymous one. Hodor strips any
// client-supplied copy before setting its own, and every route reaching this
// code is served through Hodor, so the value cannot be forged.
const HODOR_AUTH_HEADER = 'x-hodor-auth'
const OWNER_AUTH_METHODS = new Set(['password', 'bypass'])

export function hasValidOwnerSession(request: Request) {
  const method = request.headers.get(HODOR_AUTH_HEADER)
  return method !== null && OWNER_AUTH_METHODS.has(method)
}

export function createLocalTokenVerifier(
  config: McpConfig,
  store: Pick<OAuthStore, 'getActiveAccessToken'>,
): OAuthTokenVerifier {
  return {
    async verifyAccessToken(token) {
      try {
        const { payload } = await jwtVerify(
          token,
          derivedSigningKey(config.signingSecret),
          {
            algorithms: ['HS256'],
            issuer: config.issuer.toString(),
            audience: config.serverUrl.toString(),
            typ: 'JWT',
          },
        )
        if (
          typeof payload.jti !== 'string' ||
          typeof payload.cid !== 'string' ||
          typeof payload.exp !== 'number' ||
          typeof payload.scope !== 'string'
        ) {
          throw new Error('Missing access-token claims')
        }
        const scopes = payload.scope.split(' ').filter(Boolean)
        const active = await store.getActiveAccessToken(payload.jti)
        if (!active || active.clientId !== payload.cid)
          throw new Error('Token revoked')
        return {
          token,
          clientId: payload.cid,
          scopes,
          expiresAt: payload.exp,
          resource: config.serverUrl,
        }
      } catch {
        throw new OAuthError(
          OAuthErrorCode.InvalidToken,
          'The access token is invalid, expired, or revoked',
        )
      }
    },
  }
}
