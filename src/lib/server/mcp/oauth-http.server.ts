import '@tanstack/react-start/server-only'

import { OAuthException } from '@jmondi/oauth2-server'
import {
  handleVanillaError,
  requestFromVanilla,
  responseToVanilla,
} from '@jmondi/oauth2-server/vanilla'
import { z } from 'zod'
import {
  MCP_SCOPE_DETAILS,
  type McpScope,
  scopesForEnabledTools,
} from '@/lib/mcp/catalog'
import { hasValidOwnerSession } from './auth.server'
import type { McpConfig } from './config.server'
import { MCP_READ_SCOPE } from './config.server'
import { createOAuthServer } from './oauth.server'
import type { OAuthStore } from './oauth-store.server'
import { loadMcpPolicy, type McpPolicy } from './settings.server'

const PUBLIC_OAUTH_PATHS = new Set([
  '/.well-known/oauth-authorization-server',
  '/.well-known/oauth-protected-resource/api/mcp',
  '/oauth/register',
  '/oauth/authorize',
  '/oauth/token',
  '/oauth/revoke',
])
export const MCP_OWNER_BRIDGE_PATH = '/settings/mcp/authorize'

async function recordAudit(
  store: OAuthStore,
  event: Parameters<OAuthStore['audit']>[0],
) {
  try {
    await store.audit(event)
  } catch {
    console.error('Failed to persist an MCP OAuth audit event')
  }
}

const registrationSchema = z.object({
  client_name: z.string().trim().min(1).max(200).default('MCP client'),
  redirect_uris: z.array(z.string().max(2_048)).min(1).max(10),
  token_endpoint_auth_method: z.literal('none').optional().default('none'),
  grant_types: z
    .array(z.enum(['authorization_code', 'refresh_token']))
    .min(1)
    .optional()
    .default(['authorization_code', 'refresh_token']),
  response_types: z
    .array(z.literal('code'))
    .min(1)
    .optional()
    .default(['code']),
  scope: z.string().trim().max(500).optional(),
})

function parseScopes(value: string, supportedScopes: readonly McpScope[]) {
  const supported = new Set<string>(supportedScopes)
  const scopes = [...new Set(value.split(/\s+/).filter(Boolean))]
  if (scopes.some((scope) => !supported.has(scope))) {
    throw new Error('Unsupported OAuth scope')
  }
  return scopes.length > 0 ? (scopes as McpScope[]) : [MCP_READ_SCOPE]
}

function oauthUrl(config: McpConfig, path: string) {
  return new URL(path, config.issuer).toString()
}

function json(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
  if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'no-store')
  headers.set('Access-Control-Allow-Origin', '*')
  return Response.json(body, { ...init, headers })
}

function oauthError(error: unknown) {
  const response = responseToVanilla(handleVanillaError(error))
  const headers = new Headers(response.headers)
  headers.set('Cache-Control', 'no-store')
  headers.set('Access-Control-Allow-Origin', '*')
  return new Response(response.body, { status: response.status, headers })
}

function withPublicCors(response: Response) {
  const headers = new Headers(response.headers)
  headers.set('Access-Control-Allow-Origin', '*')
  return new Response(response.body, { status: response.status, headers })
}

function redirectUriIsSafe(value: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.hash || url.username || url.password) return false
  if (url.protocol === 'https:') return true
  return (
    url.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  )
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function validateResource(
  parameters: Record<string, unknown>,
  config: McpConfig,
) {
  const resource = parameters.resource
  if (resource !== config.serverUrl.toString()) {
    throw OAuthException.invalidParameter(
      'resource',
      'The resource parameter must identify this MCP server',
    )
  }
  parameters.audience = resource
}

async function oauthRequest(
  request: Request,
  config: McpConfig,
  location: 'query' | 'body',
) {
  const converted = await requestFromVanilla(request)
  validateResource(converted[location], config)
  return converted
}

function authorizationLoginRedirect(request: Request, config: McpConfig) {
  const authorize = new URL(request.url)
  // The MCP ingress forwards this path to the app in plaintext, so the bridge
  // has to come from the issuer. Deriving it from the request would send the
  // owner to an http:// login form.
  const bridge = new URL(MCP_OWNER_BRIDGE_PATH, config.issuer)
  bridge.searchParams.set('request', `${authorize.pathname}${authorize.search}`)
  return Response.redirect(bridge, 302)
}

function scopeInputName(scope: McpScope) {
  return `scope_${scope.replaceAll(':', '_')}`
}

function consentPage(
  clientName: string,
  request: Request,
  requestedScopes: McpScope[],
  redirectUri: string,
) {
  const action = new URL(request.url)
  const scopeRows = requestedScopes
    .map((scope) => {
      const details = MCP_SCOPE_DETAILS[scope]
      const readOnly = scope === MCP_READ_SCOPE
      return `<label><input type="checkbox" name="${scopeInputName(scope)}"${
        readOnly ? ' checked disabled' : ' checked'
      }> <span><strong>${escapeHtml(details.label)}</strong><small>${escapeHtml(
        details.description,
      )}</small></span></label>${
        readOnly
          ? `<input type="hidden" name="${scopeInputName(scope)}" value="on">`
          : ''
      }`
    })
    .join('')
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Authorize MCP access</title><style>body{font:16px system-ui;max-width:42rem;margin:8vh auto;padding:1.5rem;color:#102c31;background:#f4f8f8}main{border:1px solid #d3e1e2;border-radius:16px;padding:2rem;background:#fff}h1{margin-top:0}p{line-height:1.55;color:#425f64}label{display:flex;gap:.75rem;padding:1rem 0;border-top:1px solid #d3e1e2}label input{width:1.15rem;height:1.15rem;margin-top:.2rem}label span{display:grid;gap:.25rem}small{color:#597176;line-height:1.45}button{font:inherit;font-weight:600;padding:.7rem 1rem;margin:.75rem .5rem 0 0;border-radius:12px;border:1px solid #667;background:#fff;cursor:pointer}.approve{background:#087f8c;color:#fff;border-color:#087f8c}</style></head><body><main><h1>Authorize CodeTend access?</h1><p><strong>${escapeHtml(clientName)}</strong> wants to connect to this CodeTend instance. Review the requested permissions before authorizing.</p><form method="post" action="${escapeHtml(action.pathname + action.search)}">${scopeRows}<p>Clear any optional permission you do not want to grant. You can revoke this client later in Settings → MCP.</p><button class="approve" name="decision" value="approve">Authorize</button><button name="decision" value="deny">Deny</button></form></main></body></html>`,
    {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Security-Policy': [
          "default-src 'none'",
          "style-src 'unsafe-inline'",
          // Approving redirects to the client, and form-action is enforced
          // across that redirect: with only 'self' the browser silently drops
          // the navigation and the button looks broken.
          `form-action 'self' ${new URL(redirectUri).origin}`,
          "frame-ancestors 'none'",
          "base-uri 'none'",
        ].join('; '),
        'X-Frame-Options': 'DENY',
      },
    },
  )
}

function authorizationDenied(redirectUri: string, state?: string) {
  const url = new URL(redirectUri)
  url.searchParams.set('error', 'access_denied')
  url.searchParams.set(
    'error_description',
    'The resource owner denied the request',
  )
  if (state) url.searchParams.set('state', state)
  return Response.redirect(url, 302)
}

export function oauthPublicPaths() {
  return [...PUBLIC_OAUTH_PATHS]
}

export function createOAuthHttpHandler(
  config: McpConfig,
  store: OAuthStore,
  policyLoader: () => Promise<McpPolicy> = loadMcpPolicy,
) {
  return async function handleOAuthHttpRequest(
    request: Request,
  ): Promise<Response | null> {
    const url = new URL(request.url)
    if (
      !PUBLIC_OAUTH_PATHS.has(url.pathname) &&
      url.pathname !== MCP_OWNER_BRIDGE_PATH
    ) {
      return null
    }

    const policy = await policyLoader()
    const supportedScopes = scopesForEnabledTools(policy.disabledTools)
    const oauth = createOAuthServer(config, store, supportedScopes)

    if (request.method === 'OPTIONS' && PUBLIC_OAUTH_PATHS.has(url.pathname)) {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400',
        },
      })
    }

    if (url.pathname === '/.well-known/oauth-authorization-server') {
      return json(
        {
          issuer: config.issuer.toString(),
          authorization_endpoint: oauthUrl(config, '/oauth/authorize'),
          token_endpoint: oauthUrl(config, '/oauth/token'),
          registration_endpoint: oauthUrl(config, '/oauth/register'),
          revocation_endpoint: oauthUrl(config, '/oauth/revoke'),
          scopes_supported: supportedScopes,
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['none'],
          revocation_endpoint_auth_methods_supported: ['none'],
        },
        { headers: { 'Cache-Control': 'public, max-age=3600' } },
      )
    }

    if (url.pathname === '/.well-known/oauth-protected-resource/api/mcp') {
      return json(
        {
          resource: config.serverUrl.toString(),
          authorization_servers: [config.issuer.toString()],
          scopes_supported: supportedScopes,
          bearer_methods_supported: ['header'],
          resource_name: 'CodeTend code health',
        },
        { headers: { 'Cache-Control': 'public, max-age=3600' } },
      )
    }

    if (url.pathname === MCP_OWNER_BRIDGE_PATH) {
      if (!hasValidOwnerSession(request)) {
        return new Response('Owner authentication required', { status: 401 })
      }
      const destination = url.searchParams.get('request')
      if (!destination?.startsWith('/oauth/authorize?')) {
        return new Response('Invalid authorization request', { status: 400 })
      }
      return Response.redirect(new URL(destination, config.issuer), 302)
    }

    if (!policy.enabled) {
      return json(
        {
          error: 'temporarily_unavailable',
          error_description: 'MCP is paused by the owner',
        },
        { status: 503 },
      )
    }

    if (url.pathname === '/oauth/register' && request.method === 'POST') {
      try {
        const registrationBody = await request.text()
        if (Buffer.byteLength(registrationBody) > 32_768)
          return json({ error: 'invalid_client_metadata' }, { status: 413 })
        const registration = registrationSchema.parse(
          JSON.parse(registrationBody),
        )
        const registrationScopes = parseScopes(
          registration.scope ?? supportedScopes.join(' '),
          supportedScopes,
        )
        if (!registration.grant_types.includes('authorization_code')) {
          return json(
            {
              error: 'invalid_client_metadata',
              error_description: 'The authorization_code grant is required',
            },
            { status: 400 },
          )
        }
        if (!registration.redirect_uris.every(redirectUriIsSafe)) {
          return json(
            {
              error: 'invalid_redirect_uri',
              error_description:
                'Redirect URIs must use HTTPS or loopback HTTP',
            },
            { status: 400 },
          )
        }
        const clientId = crypto.randomUUID()
        await store.createClient({
          id: clientId,
          name: registration.client_name,
          redirectUris: registration.redirect_uris,
        })
        await recordAudit(store, {
          event: 'client_registered',
          outcome: 'success',
          clientId,
        })
        return json(
          {
            client_id: clientId,
            client_id_issued_at: Math.floor(Date.now() / 1_000),
            client_name: registration.client_name,
            redirect_uris: registration.redirect_uris,
            token_endpoint_auth_method: 'none',
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            scope: registrationScopes.join(' '),
          },
          { status: 201 },
        )
      } catch {
        return json(
          {
            error: 'invalid_client_metadata',
            error_description: 'Invalid registration',
          },
          { status: 400 },
        )
      }
    }

    if (
      url.pathname === '/oauth/authorize' &&
      ['GET', 'POST'].includes(request.method)
    ) {
      if (!hasValidOwnerSession(request)) {
        return authorizationLoginRedirect(request, config)
      }
      try {
        let authorizationRequest = request
        if (request.method === 'POST') {
          const formData = await request.clone().formData()
          const requested = parseScopes(
            url.searchParams.get('scope') ?? MCP_READ_SCOPE,
            supportedScopes,
          )
          const selected = requested.filter(
            (scope) =>
              scope === MCP_READ_SCOPE ||
              formData.get(scopeInputName(scope)) === 'on',
          )
          const selectedUrl = new URL(request.url)
          selectedUrl.searchParams.set('scope', selected.join(' '))
          authorizationRequest = new Request(selectedUrl, request)
        }
        const converted = await oauthRequest(
          authorizationRequest,
          config,
          'query',
        )
        const authorization =
          await oauth.server.validateAuthorizationRequest(converted)
        if (!authorization.redirectUri) {
          throw OAuthException.invalidParameter('redirect_uri')
        }
        if (request.method === 'GET') {
          const requestedScopes = authorization.scopes.map(
            ({ name }) => name as McpScope,
          )
          return consentPage(
            authorization.client.name,
            request,
            requestedScopes,
            authorization.redirectUri,
          )
        }

        const origin = request.headers.get('origin')
        if (origin && origin !== config.issuer.origin) {
          return new Response('Invalid origin', { status: 403 })
        }
        if (converted.body.decision !== 'approve') {
          await recordAudit(store, {
            event: 'authorization',
            outcome: 'denied',
            clientId: authorization.client.id,
          })
          return authorizationDenied(
            authorization.redirectUri,
            authorization.state,
          )
        }
        authorization.user = oauth.owner
        authorization.isAuthorizationApproved = true
        const response = responseToVanilla(
          await oauth.server.completeAuthorizationRequest(authorization),
        )
        await recordAudit(store, {
          event: 'authorization',
          outcome: 'success',
          clientId: authorization.client.id,
        })
        return withPublicCors(response)
      } catch (error) {
        return oauthError(error)
      }
    }

    if (url.pathname === '/oauth/token' && request.method === 'POST') {
      try {
        const converted = await oauthRequest(request, config, 'body')
        const clientId = String(converted.body.client_id ?? '')
        const response = responseToVanilla(
          await oauth.server.respondToAccessTokenRequest(converted),
        )
        await recordAudit(store, {
          event: 'token_issued',
          outcome: 'success',
          clientId,
        })
        return withPublicCors(response)
      } catch (error) {
        await recordAudit(store, { event: 'token_issued', outcome: 'failure' })
        return oauthError(error)
      }
    }

    if (url.pathname === '/oauth/revoke' && request.method === 'POST') {
      try {
        const converted = await requestFromVanilla(request)
        const response = responseToVanilla(await oauth.server.revoke(converted))
        await recordAudit(store, {
          event: 'token_revoked',
          outcome: 'success',
          clientId: String(converted.body.client_id ?? ''),
        })
        return withPublicCors(response)
      } catch (error) {
        return oauthError(error)
      }
    }

    return new Response('Method not allowed', { status: 405 })
  }
}
