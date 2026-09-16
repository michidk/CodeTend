import { describe, expect, test } from 'bun:test'
import { createHash, randomUUID } from 'node:crypto'
import { SignJWT } from 'jose'
import { MCP_SCOPE_VALUES, MCP_TOOL_CATALOG } from '@/lib/mcp/catalog'
import { getOAuthSigningKey } from './auth.server'
import type { McpConfig } from './config.server'
import { MCP_READ_SCOPE } from './config.server'
import { createMcpHttpHandler, handlesMcpHttpPath } from './http.server'
import type {
  OAuthAuditEvent,
  OAuthStore,
  StoredAuthorizationCode,
  StoredOAuthClient,
  StoredOAuthToken,
} from './oauth-store.server'
import { hashOAuthSecret } from './oauth-store.server'

class MemoryOAuthStore implements OAuthStore {
  clients = new Map<string, StoredOAuthClient>()
  codes = new Map<string, StoredAuthorizationCode>()
  tokens = new Map<string, StoredOAuthToken>()
  audits: OAuthAuditEvent[] = []

  async createClient(client: Omit<StoredOAuthClient, 'revokedAt'>) {
    this.clients.set(client.id, { ...client, revokedAt: null })
  }
  async getClient(id: string) {
    return this.clients.get(id) ?? null
  }
  async saveAuthorizationCode(code: StoredAuthorizationCode) {
    this.codes.set(code.code, structuredClone(code))
  }
  async getAuthorizationCode(code: string) {
    return this.codes.get(code) ?? null
  }
  async revokeAuthorizationCode(code: string) {
    const stored = this.codes.get(code)
    if (stored) stored.revokedAt = new Date()
  }
  async saveAccessToken(token: StoredOAuthToken) {
    this.tokens.set(token.accessTokenId, {
      ...structuredClone(token),
      originatingAuthorizationCodeHash:
        token.originatingAuthorizationCodeHash ??
        (token.originatingAuthorizationCode
          ? hashOAuthSecret(token.originatingAuthorizationCode)
          : null),
    })
  }
  async attachRefreshToken(id: string, refreshToken: string, expiresAt: Date) {
    const token = this.tokens.get(id)
    if (token)
      Object.assign(token, { refreshToken, refreshTokenExpiresAt: expiresAt })
  }
  async getByRefreshToken(refreshToken: string) {
    return (
      [...this.tokens.values()].find(
        (token) => token.refreshToken === refreshToken,
      ) ?? null
    )
  }
  async getByAccessToken(id: string) {
    const token = this.tokens.get(id)
    return token ? { ...token, refreshToken: undefined } : null
  }
  async getActiveAccessToken(id: string) {
    const token = this.tokens.get(id)
    return token && !token.revokedAt && token.accessTokenExpiresAt > new Date()
      ? token
      : null
  }
  async revokeToken(id: string) {
    const token = this.tokens.get(id)
    if (token) token.revokedAt = new Date()
  }
  async consumeRefreshToken(id: string) {
    const token = this.tokens.get(id)
    if (!token || token.revokedAt || !token.refreshTokenExpiresAt) return false
    token.revokedAt = new Date()
    return true
  }
  async revokeTokenFamily(authorizationCodeHash: string) {
    for (const token of this.tokens.values()) {
      if (token.originatingAuthorizationCodeHash === authorizationCodeHash) {
        token.revokedAt = new Date()
      }
    }
  }
  async revokeDescendants(code: string) {
    for (const token of this.tokens.values()) {
      if (token.originatingAuthorizationCode === code)
        token.revokedAt = new Date()
    }
  }
  async audit(event: OAuthAuditEvent) {
    this.audits.push(event)
  }
}

const config: McpConfig = {
  serverUrl: new URL('https://codetend.example.com/api/mcp'),
  issuer: new URL('https://codetend.example.com/'),
  signingSecret: 'a'.repeat(64),
  allowedHostnames: ['codetend.example.com'],
  allowedOrigins: ['https://chatgpt.com'],
  dangerouslyAllowInsecureUrls: false,
}

function request(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers)
  headers.set('Host', config.serverUrl.host)
  return new Request(new URL(path, config.issuer), { ...init, headers })
}

// Hodor sets this on every request it proxies after admitting the owner.
const OWNER_HEADERS = { 'X-Hodor-Auth': 'password' } as const

function form(values: Record<string, string>) {
  return new URLSearchParams(values)
}

describe('remote MCP OAuth HTTP flow', () => {
  test('owner policy can pause protocol and OAuth requests', async () => {
    const store = new MemoryOAuthStore()
    const handle = createMcpHttpHandler(
      config,
      store,
      {
        async fetch() {
          return Response.json({ ok: true })
        },
      },
      async () => ({ enabled: false, disabledTools: [] }),
    )

    const metadata = await handle(
      request('/.well-known/oauth-authorization-server'),
    )
    expect(metadata?.status).toBe(200)
    const registration = await handle(
      request('/oauth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }),
    )
    expect(registration?.status).toBe(503)
    const protocol = await handle(request('/api/mcp', { method: 'POST' }))
    expect(protocol?.status).toBe(503)
  })

  test('discovers, registers, authorizes, rotates, revokes, audits, and applies CORS', async () => {
    const store = new MemoryOAuthStore()
    const protocol = {
      async fetch() {
        return Response.json({ jsonrpc: '2.0', result: { ok: true }, id: 1 })
      },
    }
    const handle = createMcpHttpHandler(config, store, protocol)

    const discovery = await handle(
      request('/.well-known/oauth-authorization-server'),
    )
    expect(discovery?.status).toBe(200)
    expect(await discovery?.json()).toMatchObject({
      issuer: config.issuer.toString(),
      registration_endpoint: 'https://codetend.example.com/oauth/register',
      code_challenge_methods_supported: ['S256'],
      scopes_supported: MCP_SCOPE_VALUES,
    })

    const registration = await handle(
      request('/oauth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Codex',
          redirect_uris: ['http://127.0.0.1:1455/callback'],
          scope: MCP_SCOPE_VALUES.join(' '),
        }),
      }),
    )
    expect(registration?.status).toBe(201)
    const client = (await registration?.json()) as { client_id: string }

    const verifier = 'v'.repeat(43)
    const pkce = createHash('sha256').update(verifier).digest('base64url')
    const authorize = new URL('/oauth/authorize', config.issuer)
    authorize.search = form({
      response_type: 'code',
      client_id: client.client_id,
      redirect_uri: 'http://127.0.0.1:9876/callback',
      scope: MCP_SCOPE_VALUES.join(' '),
      resource: config.serverUrl.toString(),
      code_challenge: pkce,
      code_challenge_method: 'S256',
      state: 'state-123',
    }).toString()
    const loginRedirect = await handle(
      new Request(authorize, { headers: { Host: config.serverUrl.host } }),
    )
    expect(loginRedirect?.status).toBe(302)
    expect(loginRedirect?.headers.get('location')).toContain(
      '/settings/mcp/authorize',
    )

    const consent = await handle(
      new Request(authorize, {
        headers: { ...OWNER_HEADERS, Host: config.serverUrl.host },
      }),
    )
    expect(consent?.status).toBe(200)
    const consentBody = await consent?.text()
    expect(consentBody).toContain('Codex')
    expect(consentBody).toContain('Manage findings and scans')
    expect(consentBody).toContain('name="scope_codetend_write" checked')

    const approved = await handle(
      new Request(authorize, {
        method: 'POST',
        headers: {
          ...OWNER_HEADERS,
          Host: config.serverUrl.host,
          Origin: config.issuer.origin,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form({
          decision: 'approve',
          scope_codetend_write: 'on',
        }),
      }),
    )
    expect(approved?.status).toBe(302)
    const callback = new URL(approved?.headers.get('location') ?? '')
    expect(callback.port).toBe('9876')
    expect(callback.searchParams.get('state')).toBe('state-123')
    const code = callback.searchParams.get('code') ?? ''

    const tokenResponse = await handle(
      request('/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form({
          grant_type: 'authorization_code',
          client_id: client.client_id,
          code,
          redirect_uri: 'http://127.0.0.1:9876/callback',
          code_verifier: verifier,
          resource: config.serverUrl.toString(),
        }),
      }),
    )
    expect(tokenResponse?.status).toBe(200)
    expect(tokenResponse?.headers.get('access-control-allow-origin')).toBe('*')
    const firstTokens = (await tokenResponse?.json()) as {
      access_token: string
      refresh_token: string
    }
    expect([...store.tokens.values()].at(-1)?.scopes).toEqual([
      MCP_READ_SCOPE,
      'codetend:write',
    ])

    const initialize = await handle(
      request('/api/mcp', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${firstTokens.access_token}`,
          Origin: 'https://chatgpt.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }),
      }),
    )
    expect(initialize?.status).toBe(200)
    expect(initialize?.headers.get('access-control-allow-origin')).toBe(
      'https://chatgpt.com',
    )

    const toolCall = await handle(
      request('/api/mcp', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${firstTokens.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/call',
          params: { name: 'get_repository', arguments: { repositoryId: 1 } },
          id: 2,
        }),
      }),
    )
    expect(toolCall?.status).toBe(200)
    expect(store.audits.at(-1)).toMatchObject({
      event: 'tool_called',
      toolName: 'get_repository',
    })
    expect(JSON.stringify(store.audits)).not.toContain('private')

    const refreshed = await handle(
      request('/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form({
          grant_type: 'refresh_token',
          client_id: client.client_id,
          refresh_token: firstTokens.refresh_token,
          resource: config.serverUrl.toString(),
        }),
      }),
    )
    expect(refreshed?.status).toBe(200)
    const secondTokens = (await refreshed?.json()) as {
      access_token: string
      refresh_token: string
    }
    expect(secondTokens.refresh_token).not.toBe(firstTokens.refresh_token)

    const replay = await handle(
      request('/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form({
          grant_type: 'refresh_token',
          client_id: client.client_id,
          refresh_token: firstTokens.refresh_token,
          resource: config.serverUrl.toString(),
        }),
      }),
    )
    expect(replay?.status).toBe(400)

    const familyRevoked = await handle(
      request('/api/mcp', {
        method: 'POST',
        headers: { Authorization: `Bearer ${secondTokens.access_token}` },
      }),
    )
    expect(familyRevoked?.status).toBe(401)

    const revoke = await handle(
      request('/oauth/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form({
          token: secondTokens.access_token,
          client_id: client.client_id,
        }),
      }),
    )
    expect(revoke?.status).toBe(200)

    const revokedCall = await handle(
      request('/api/mcp', {
        method: 'POST',
        headers: { Authorization: `Bearer ${secondTokens.access_token}` },
      }),
    )
    expect(revokedCall?.status).toBe(401)

    const unauthenticated = await handle(
      request('/api/mcp', {
        method: 'POST',
        headers: { Origin: 'https://chatgpt.com' },
      }),
    )
    expect(unauthenticated?.status).toBe(401)
    expect(unauthenticated?.headers.get('www-authenticate')).toContain(
      'resource_metadata=',
    )
    expect(unauthenticated?.headers.get('access-control-allow-origin')).toBe(
      'https://chatgpt.com',
    )

    const wrongScopeId = randomUUID()
    await store.saveAccessToken({
      accessTokenId: wrongScopeId,
      clientId: client.client_id,
      scopes: ['wrong'],
      accessTokenExpiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
    })
    const wrongScope = await new SignJWT({
      cid: client.client_id,
      scope: 'wrong',
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer(config.issuer.toString())
      .setAudience(config.serverUrl.toString())
      .setJti(wrongScopeId)
      .setIssuedAt()
      .setExpirationTime('1m')
      .sign(getOAuthSigningKey(config.signingSecret))
    const forbidden = await handle(
      request('/api/mcp', {
        method: 'POST',
        headers: { Authorization: `Bearer ${wrongScope}` },
      }),
    )
    expect(forbidden?.status).toBe(403)

    const preflight = await handle(
      request('/api/mcp', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://chatgpt.com',
          'Access-Control-Request-Method': 'POST',
        },
      }),
    )
    expect(preflight?.status).toBe(204)
    expect(preflight?.headers.get('access-control-allow-headers')).toContain(
      'MCP-Protocol-Version',
    )
  })

  test('routes the owner consent bridge instead of falling through to the router', () => {
    // The live entry point returns null for unhandled paths, which lets the
    // application router answer with its own 404. The bridge must not fall
    // through, or the ChatGPT consent hand-off dead-ends on "Not Found".
    expect(handlesMcpHttpPath('/settings/mcp/authorize')).toBe(true)
    expect(handlesMcpHttpPath('/api/mcp')).toBe(true)
    expect(handlesMcpHttpPath('/oauth/authorize')).toBe(true)
    expect(handlesMcpHttpPath('/settings/mcp')).toBe(false)
    expect(handlesMcpHttpPath('/dives')).toBe(false)
  })

  test('owner consent bridge returns the signed-in owner to the authorize request', async () => {
    const handle = createMcpHttpHandler(config, new MemoryOAuthStore(), {
      async fetch() {
        return Response.json({ ok: true })
      },
    })

    const authorizeRequest = '/oauth/authorize?client_id=abc&response_type=code'
    const bridge = `/settings/mcp/authorize?request=${encodeURIComponent(authorizeRequest)}`

    const anonymous = await handle(request(bridge))
    expect(anonymous?.status).toBe(401)

    const resumed = await handle(request(bridge, { headers: OWNER_HEADERS }))
    expect(resumed?.status).toBe(302)
    expect(resumed?.headers.get('location')).toBe(
      new URL(authorizeRequest, config.issuer).toString(),
    )

    const rejected = await handle(
      request('/settings/mcp/authorize?request=%2F%2Fevil.example.com', {
        headers: OWNER_HEADERS,
      }),
    )
    expect(rejected?.status).toBe(400)
  })

  test('sends the owner to the bridge over the issuer scheme, not the proxied one', async () => {
    const handle = createMcpHttpHandler(config, new MemoryOAuthStore(), {
      async fetch() {
        return Response.json({ ok: true })
      },
    })

    // The MCP ingress forwards /oauth/authorize to the app in plaintext, so
    // request.url is http even though the public issuer is https. Redirecting
    // to the request scheme would put the Hodor password form on http://.
    const proxied = new Request(
      'http://codetend.example.com/oauth/authorize?client_id=x',
      {
        headers: { Host: config.serverUrl.host },
      },
    )

    const redirect = await handle(proxied)
    expect(redirect?.status).toBe(302)
    const location = new URL(redirect?.headers.get('location') ?? '')
    expect(location.protocol).toBe('https:')
    expect(location.origin).toBe(config.issuer.origin)
    expect(location.pathname).toBe('/settings/mcp/authorize')
    expect(location.searchParams.get('request')).toBe(
      '/oauth/authorize?client_id=x',
    )
  })

  test('consent lets the browser reach the client after approval', async () => {
    const store = new MemoryOAuthStore()
    const handle = createMcpHttpHandler(config, store, {
      async fetch() {
        return Response.json({ ok: true })
      },
    })

    const registration = await handle(
      request('/oauth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: 'ChatGPT',
          redirect_uris: ['https://chatgpt.com/connector/oauth/ABC'],
        }),
      }),
    )
    const client = (await registration?.json()) as {
      client_id: string
      scope: string
    }

    // A client that omits `scope` is offered everything currently enabled, or
    // the consent page can never present write and delete.
    expect(client.scope.split(' ').sort()).toEqual([...MCP_SCOPE_VALUES].sort())

    const authorize = new URL('/oauth/authorize', config.issuer)
    authorize.search = form({
      response_type: 'code',
      client_id: client.client_id,
      redirect_uri: 'https://chatgpt.com/connector/oauth/ABC',
      scope: MCP_READ_SCOPE,
      resource: config.serverUrl.toString(),
      code_challenge: createHash('sha256')
        .update('v'.repeat(43))
        .digest('base64url'),
      code_challenge_method: 'S256',
      state: 'state-csp',
    }).toString()

    const consent = await handle(
      new Request(authorize, {
        headers: { ...OWNER_HEADERS, Host: config.serverUrl.host },
      }),
    )
    expect(consent?.status).toBe(200)

    // form-action is enforced across the redirect the submission lands on, so
    // omitting the client origin silently blocks the navigation.
    const csp = consent?.headers.get('content-security-policy') ?? ''
    expect(csp).toContain("form-action 'self' https://chatgpt.com")
    expect(csp).toContain("frame-ancestors 'none'")
  })

  test('advertises every enabled scope in the auth challenge', async () => {
    const handle = createMcpHttpHandler(config, new MemoryOAuthStore(), {
      async fetch() {
        return Response.json({ ok: true })
      },
    })

    // Clients take the challenge's `scope` as the set to request, so listing only
    // the scope required to call the endpoint leaves scan control ungrantable.
    const challenged = await handle(request('/api/mcp', { method: 'POST' }))
    expect(challenged?.status).toBe(401)
    expect(challenged?.headers.get('www-authenticate')).toContain(
      `scope="${MCP_SCOPE_VALUES.join(' ')}"`,
    )

    const restricted = createMcpHttpHandler(
      config,
      new MemoryOAuthStore(),
      {
        async fetch() {
          return Response.json({ ok: true })
        },
      },
      async () => ({
        enabled: true,
        disabledTools: MCP_TOOL_CATALOG.filter(
          (tool) => tool.scope === 'codetend:write',
        ).map((tool) => tool.name),
      }),
    )
    // A scope survives while any tool using it is enabled, so dropping write
    // from the advertisement means disabling the whole group.
    const narrowed = await restricted(request('/api/mcp', { method: 'POST' }))
    expect(narrowed?.headers.get('www-authenticate')).toContain(
      'scope="codetend:read"',
    )
  })
})
