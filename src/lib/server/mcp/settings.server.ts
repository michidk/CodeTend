import '@tanstack/react-start/server-only'

import { getRequest } from '@tanstack/react-start/server'
import { and, count, desc, eq, gt, isNull } from 'drizzle-orm'
import { getDb } from '@/db'
import {
  mcpAuditEvents,
  mcpSettings,
  oauthClients,
  oauthTokens,
} from '@/db/schema'
import {
  MCP_TOOL_CATALOG,
  MCP_TOOL_NAMES,
  type McpToolName,
  scopesForEnabledTools,
} from '@/lib/mcp/catalog'
import { getMcpConfig } from './config.server'
import { DrizzleOAuthStore } from './oauth-store.server'

export type McpPolicy = {
  enabled: boolean
  disabledTools: McpToolName[]
}

const DEFAULT_POLICY: McpPolicy = { enabled: true, disabledTools: [] }

function knownDisabledTools(values: readonly string[]) {
  const known = new Set<string>(MCP_TOOL_NAMES)
  return values.filter((value): value is McpToolName => known.has(value))
}

export async function loadMcpPolicy(): Promise<McpPolicy> {
  const [row] = await getDb()
    .select({
      enabled: mcpSettings.enabled,
      disabledTools: mcpSettings.disabledTools,
    })
    .from(mcpSettings)
    .where(eq(mcpSettings.id, 'instance'))
    .limit(1)
  return row
    ? {
        enabled: row.enabled,
        disabledTools: knownDisabledTools(row.disabledTools),
      }
    : DEFAULT_POLICY
}

export async function saveMcpPolicy(policy: McpPolicy) {
  const disabledTools = knownDisabledTools(policy.disabledTools)
  const [row] = await getDb()
    .insert(mcpSettings)
    .values({ id: 'instance', enabled: policy.enabled, disabledTools })
    .onConflictDoUpdate({
      target: mcpSettings.id,
      set: { enabled: policy.enabled, disabledTools, updatedAt: new Date() },
    })
    .returning({
      enabled: mcpSettings.enabled,
      disabledTools: mcpSettings.disabledTools,
    })
  return {
    enabled: row?.enabled ?? policy.enabled,
    disabledTools: knownDisabledTools(row?.disabledTools ?? disabledTools),
  }
}

export async function revokeMcpClient(clientId: string) {
  await getDb().transaction(async (transaction) => {
    const [client] = await transaction
      .update(oauthClients)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(eq(oauthClients.id, clientId))
      .returning({ id: oauthClients.id })
    if (!client) throw new Error('The MCP client was not found')
    await transaction
      .update(oauthTokens)
      .set({ revokedAt: new Date() })
      .where(eq(oauthTokens.clientId, clientId))
    await transaction.insert(mcpAuditEvents).values({
      event: 'client_revoked',
      outcome: 'success',
      clientId,
    })
  })
}

export const MCP_AUDIT_PAGE_SIZE = 25

function serializeAuditEvent(event: {
  id: number
  event: string
  outcome: string
  clientId: string | null
  toolName: string | null
  createdAt: Date
}) {
  return { ...event, createdAt: event.createdAt.toISOString() }
}

// Every tool call is audited, so the table grows without bound and a fixed tail
// would hide everything older than the last page.
export async function loadMcpAuditPage(page = 0) {
  const db = getDb()
  const offset = Math.max(0, page) * MCP_AUDIT_PAGE_SIZE
  const [rows, [totals]] = await Promise.all([
    db
      .select()
      .from(mcpAuditEvents)
      .orderBy(desc(mcpAuditEvents.createdAt))
      .limit(MCP_AUDIT_PAGE_SIZE)
      .offset(offset),
    db.select({ total: count() }).from(mcpAuditEvents),
  ])
  return {
    events: rows.map(serializeAuditEvent),
    total: Number(totals?.total ?? 0),
    page: Math.max(0, page),
    pageSize: MCP_AUDIT_PAGE_SIZE,
  }
}

// Runs on every admin page load, which is the owner-controlled point where
// stale registrations are safe to reclaim without a background scheduler.
export async function pruneStaleMcpClients() {
  return new DrizzleOAuthStore().pruneStaleClients()
}

export async function loadMcpAdminState() {
  const db = getDb()
  await pruneStaleMcpClients()

  const [policy, clientRows, activeTokenRows, audit] = await Promise.all([
    loadMcpPolicy(),
    db.select().from(oauthClients).orderBy(desc(oauthClients.createdAt)),
    // Only active tokens are loaded, so this stays bounded by the
    // registered-client cap instead of the full historical token table.
    db
      .select({ clientId: oauthTokens.clientId, scopes: oauthTokens.scopes })
      .from(oauthTokens)
      .where(
        and(
          isNull(oauthTokens.revokedAt),
          gt(oauthTokens.accessTokenExpiresAt, new Date()),
        ),
      ),
    loadMcpAuditPage(0),
  ])

  const activeByClient = new Map<
    string,
    { count: number; scopes: Set<string> }
  >()
  for (const token of activeTokenRows) {
    const entry = activeByClient.get(token.clientId) ?? {
      count: 0,
      scopes: new Set<string>(),
    }
    entry.count += 1
    for (const scope of token.scopes) entry.scopes.add(scope)
    activeByClient.set(token.clientId, entry)
  }

  let endpoint: string | null = null
  let configurationError: string | null = null
  try {
    endpoint = getMcpConfig(getRequest()).serverUrl.toString()
  } catch (error) {
    configurationError =
      error instanceof Error ? error.message : 'The MCP environment is invalid'
  }

  const clients = clientRows.map((client) => {
    const active = activeByClient.get(client.id)
    return {
      id: client.id,
      name: client.name,
      redirectUris: client.redirectUris,
      revokedAt: client.revokedAt?.toISOString() ?? null,
      createdAt: client.createdAt.toISOString(),
      activeTokenCount: active?.count ?? 0,
      scopes: active ? [...active.scopes] : [],
    }
  })

  return {
    configured: endpoint !== null,
    endpoint,
    configurationError,
    policy,
    supportedScopes: scopesForEnabledTools(policy.disabledTools),
    tools: MCP_TOOL_CATALOG.map((tool) => ({ ...tool })),
    clients,
    audit,
  }
}
