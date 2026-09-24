import '@tanstack/react-start/server-only'

import {
  createMcpHandler,
  getOAuthProtectedResourceMetadataUrl,
  hostHeaderValidationResponse,
  requireBearerAuth,
} from '@modelcontextprotocol/server'
import {
  MCP_TOOL_CATALOG,
  type McpToolName,
  mcpScopeSchema,
  scopesForEnabledTools,
} from '@/lib/mcp/catalog'
import { createLocalTokenVerifier } from './auth.server'
import { getMcpConfig, MCP_READ_SCOPE, type McpConfig } from './config.server'
import {
  createOAuthHttpHandler,
  MCP_OWNER_BRIDGE_PATH,
  oauthPublicPaths,
} from './oauth-http.server'
import { DrizzleOAuthStore, type OAuthStore } from './oauth-store.server'
import { loadMcpPolicy, type McpPolicy } from './settings.server'
import { createCodeTendMcpServer } from './tools.server'

const MCP_PATH = '/api/mcp'
const defaultPolicyLoader = async (): Promise<McpPolicy> => ({
  enabled: true,
  disabledTools: [],
})

export function handlesMcpHttpPath(pathname: string) {
  return (
    pathname === MCP_PATH ||
    pathname === MCP_OWNER_BRIDGE_PATH ||
    oauthPublicPaths().includes(pathname)
  )
}

function createProtocolHandler(policyLoader: () => Promise<McpPolicy>) {
  return createMcpHandler(async ({ authInfo }) => {
    const policy = await policyLoader()
    const disabled = new Set<string>(policy.disabledTools)
    const enabledTools = policy.enabled
      ? MCP_TOOL_CATALOG.flatMap((tool) =>
          disabled.has(tool.name) ? [] : [tool.name as McpToolName],
        )
      : []
    const scopes = (authInfo?.scopes ?? []).flatMap((scope) => {
      const parsed = mcpScopeSchema.safeParse(scope)
      return parsed.success ? [parsed.data] : []
    })
    return createCodeTendMcpServer(undefined, { scopes, enabledTools })
  })
}

type ProtocolHandler = {
  fetch(request: Request, options: Record<string, unknown>): Promise<Response>
}

function corsOrigin(request: Request, config: McpConfig) {
  const origin = request.headers.get('origin')
  if (!origin) return null
  const allowed = new Set([config.issuer.origin, ...config.allowedOrigins])
  return allowed.has(origin) ? origin : false
}

function withMcpCors(response: Response, origin: string | null) {
  if (!origin) return response
  const headers = new Headers(response.headers)
  headers.set('Access-Control-Allow-Origin', origin)
  headers.append('Vary', 'Origin')
  headers.set(
    'Access-Control-Expose-Headers',
    'WWW-Authenticate, MCP-Protocol-Version',
  )
  return new Response(response.body, { status: response.status, headers })
}

// requireBearerAuth advertises exactly the scopes it enforces, and read alone is
// enough to call the endpoint. Clients that take the challenge's `scope` as the
// set to request — ChatGPT does — would therefore never ask for write or delete,
// leaving the owner no way to grant them. Advertise everything currently enabled
// and let the consent screen decide what is actually granted.
function advertiseGrantableScopes(
  response: Response,
  grantable: readonly string[],
) {
  const challenge = response.headers.get('WWW-Authenticate')
  if (!challenge || grantable.length === 0) return response
  const headers = new Headers(response.headers)
  headers.set(
    'WWW-Authenticate',
    challenge.replace(/scope="[^"]*"/, `scope="${grantable.join(' ')}"`),
  )
  return new Response(response.body, { status: response.status, headers })
}

function mcpPreflight(origin: string) {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      Vary: 'Origin',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers':
        'Authorization, Content-Type, MCP-Protocol-Version, MCP-Method, MCP-Name',
      'Access-Control-Expose-Headers': 'WWW-Authenticate, MCP-Protocol-Version',
      'Access-Control-Max-Age': '86400',
    },
  })
}

async function calledToolName(request: Request) {
  if (request.method !== 'POST') return undefined
  try {
    const body = (await request.clone().json()) as {
      method?: unknown
      params?: { name?: unknown }
    }
    return body.method === 'tools/call' && typeof body.params?.name === 'string'
      ? body.params.name.slice(0, 200)
      : undefined
  } catch {
    return undefined
  }
}

async function recordToolAudit(
  store: OAuthStore,
  event: Parameters<OAuthStore['audit']>[0],
) {
  try {
    await store.audit(event)
  } catch {
    console.error('[CodeTend] failed to persist an MCP tool audit event')
  }
}

export function createMcpHttpHandler(
  config: McpConfig,
  store: OAuthStore,
  protocolHandler?: ProtocolHandler,
  policyLoader: () => Promise<McpPolicy> = defaultPolicyLoader,
) {
  const oauthHandler = createOAuthHttpHandler(config, store, policyLoader)
  const protocol = protocolHandler ?? createProtocolHandler(policyLoader)
  const authGate = requireBearerAuth({
    verifier: createLocalTokenVerifier(config, store),
    requiredScopes: [MCP_READ_SCOPE],
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(config.serverUrl),
  })

  return async (request: Request): Promise<Response | null> => {
    const pathname = new URL(request.url).pathname
    if (pathname !== MCP_PATH) {
      if (oauthPublicPaths().includes(pathname)) {
        const rejectedHost = hostHeaderValidationResponse(
          request,
          config.allowedHostnames,
        )
        if (rejectedHost) return rejectedHost
      }
      return oauthHandler(request)
    }

    const rejectedHost = hostHeaderValidationResponse(
      request,
      config.allowedHostnames,
    )
    if (rejectedHost) return rejectedHost

    const origin = corsOrigin(request, config)
    if (origin === false)
      return new Response('Forbidden origin', { status: 403 })
    if (request.method === 'OPTIONS')
      return mcpPreflight(origin ?? config.issuer.origin)

    const policy = await policyLoader()
    if (!policy.enabled) {
      return withMcpCors(
        Response.json(
          {
            error: 'mcp_disabled',
            error_description: 'MCP is paused by the owner',
          },
          { status: 503 },
        ),
        origin,
      )
    }

    const auth = await authGate(request)
    if (auth instanceof Response) {
      return withMcpCors(
        advertiseGrantableScopes(
          auth,
          scopesForEnabledTools(policy.disabledTools),
        ),
        origin,
      )
    }

    const toolName = await calledToolName(request)
    try {
      const response = await protocol.fetch(request, { authInfo: auth })
      if (toolName) {
        await recordToolAudit(store, {
          event: 'tool_called',
          outcome: response.ok ? 'success' : 'failure',
          clientId: auth.clientId,
          toolName,
        })
      }
      return withMcpCors(response, origin)
    } catch (error) {
      if (toolName) {
        await recordToolAudit(store, {
          event: 'tool_called',
          outcome: 'failure',
          clientId: auth.clientId,
          toolName,
        })
      }
      throw error
    }
  }
}

const liveStore = new DrizzleOAuthStore()
const liveProtocolHandler = createProtocolHandler(loadMcpPolicy)

export async function handleMcpHttpRequest(
  request: Request,
): Promise<Response | null> {
  try {
    const pathname = new URL(request.url).pathname
    if (!handlesMcpHttpPath(pathname)) return null

    const config = getMcpConfig(request)
    const handler = createMcpHttpHandler(
      config,
      liveStore,
      liveProtocolHandler,
      loadMcpPolicy,
    )
    return await handler(request)
  } catch (error) {
    console.error('[CodeTend] MCP request failed', error)
    return Response.json(
      {
        error: 'server_error',
        error_description: 'MCP service is unavailable',
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
