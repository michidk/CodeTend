import '@tanstack/react-start/server-only'

import {
  createMcpHandler,
  hostHeaderValidationResponse,
  originValidationResponse,
} from '@modelcontextprotocol/server'
import {
  MCP_SCOPE_VALUES,
  MCP_TOOL_CATALOG,
  type McpToolName,
} from '@/lib/mcp/catalog'
import { getMcpConfig, type McpConfig } from './config.server'
import {
  loadMcpPolicy,
  type McpAuditEvent,
  type McpPolicy,
  recordMcpAudit,
} from './settings.server'
import { createCodeTendMcpServer } from './tools.server'

const MCP_PATH = '/api/mcp'
const defaultPolicyLoader = async (): Promise<McpPolicy> => ({
  enabled: true,
  disabledTools: [],
})

export function handlesMcpHttpPath(pathname: string) {
  return pathname === MCP_PATH
}

// Stateless: a fresh server per request. The SDK serves protocol 2026-07-28
// natively and answers 2025-era clients through its stateless fallback. There
// is no per-client identity, so the owner's tool policy is the only gate.
function createProtocolHandler(policyLoader: () => Promise<McpPolicy>) {
  return createMcpHandler(async () => {
    const policy = await policyLoader()
    const disabled = new Set<string>(policy.disabledTools)
    const enabledTools = policy.enabled
      ? MCP_TOOL_CATALOG.flatMap((tool) =>
          disabled.has(tool.name) ? [] : [tool.name as McpToolName],
        )
      : []
    return createCodeTendMcpServer(undefined, {
      scopes: MCP_SCOPE_VALUES,
      enabledTools,
    })
  })
}

type ProtocolHandler = {
  fetch(request: Request, options?: Record<string, unknown>): Promise<Response>
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
  audit: (event: McpAuditEvent) => Promise<void>,
  event: McpAuditEvent,
) {
  try {
    await audit(event)
  } catch {
    console.error('[CodeTend] failed to persist an MCP tool audit event')
  }
}

export function createMcpHttpHandler(
  config: McpConfig,
  audit: (event: McpAuditEvent) => Promise<void> = async () => {},
  protocolHandler?: ProtocolHandler,
  policyLoader: () => Promise<McpPolicy> = defaultPolicyLoader,
) {
  const protocol = protocolHandler ?? createProtocolHandler(policyLoader)

  return async (request: Request): Promise<Response | null> => {
    if (new URL(request.url).pathname !== MCP_PATH) return null

    // DNS-rebinding defence; there is no CORS because browsers are not a
    // supported MCP client, so an allowed Origin still gets no CORS headers.
    const rejected =
      hostHeaderValidationResponse(request, config.allowedHostnames) ??
      originValidationResponse(request, config.allowedOrigins)
    if (rejected) return rejected

    const policy = await policyLoader()
    if (!policy.enabled) {
      return Response.json(
        {
          error: 'mcp_disabled',
          error_description: 'MCP is paused by the owner',
        },
        { status: 503 },
      )
    }

    const toolName = await calledToolName(request)
    const outcome = (ok: boolean) =>
      toolName
        ? recordToolAudit(audit, {
            event: 'tool_called',
            outcome: ok ? 'success' : 'failure',
            toolName,
          })
        : undefined
    try {
      const response = await protocol.fetch(request)
      await outcome(response.ok)
      return response
    } catch (error) {
      await outcome(false)
      throw error
    }
  }
}

const liveProtocolHandler = createProtocolHandler(loadMcpPolicy)

export async function handleMcpHttpRequest(
  request: Request,
): Promise<Response | null> {
  try {
    if (!handlesMcpHttpPath(new URL(request.url).pathname)) return null
    return await createMcpHttpHandler(
      getMcpConfig(),
      recordMcpAudit,
      liveProtocolHandler,
      loadMcpPolicy,
    )(request)
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
