import '@tanstack/react-start/server-only'

import { randomBytes, randomUUID } from 'node:crypto'
import {
  AuthorizationServer,
  DateInterval,
  type GrantIdentifier,
  JwtService,
  type OAuthAuthCode,
  type OAuthAuthCodeRepository,
  type OAuthClient,
  type OAuthClientRepository,
  OAuthException,
  type OAuthScope,
  type OAuthScopeRepository,
  type OAuthToken,
  type OAuthTokenRepository,
  type OAuthUserRepository,
} from '@jmondi/oauth2-server'
import { MCP_SCOPE_VALUES, type McpScope } from '@/lib/mcp/catalog'
import { getOAuthSigningKey } from './auth.server'
import type { McpConfig } from './config.server'
import { MCP_READ_SCOPE } from './config.server'
import type {
  OAuthStore,
  StoredAuthorizationCode,
  StoredOAuthToken,
} from './oauth-store.server'

const OWNER = { id: 'instance-owner' } as const
const scopeEntity = (name: McpScope) => ({ name })

function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url')
}

function clientEntity(
  row: NonNullable<Awaited<ReturnType<OAuthStore['getClient']>>>,
  supportedScopes: readonly McpScope[],
) {
  return {
    id: row.id,
    name: row.name,
    redirectUris: row.redirectUris,
    allowedGrants: ['authorization_code', 'refresh_token'] as GrantIdentifier[],
    scopes: supportedScopes.map(scopeEntity),
    revokedAt: row.revokedAt,
  } satisfies OAuthClient
}

export class CodeTendOAuthRepositories
  implements OAuthClientRepository, OAuthScopeRepository, OAuthUserRepository
{
  constructor(
    readonly store: OAuthStore,
    readonly supportedScopes: readonly McpScope[] = MCP_SCOPE_VALUES,
  ) {}

  async getByIdentifier(clientId: string) {
    const row = await this.store.getClient(clientId)
    if (!row) throw OAuthException.invalidClient()
    return clientEntity(row, this.supportedScopes)
  }

  async isClientValid(grant: GrantIdentifier, client: OAuthClient) {
    const row = await this.store.getClient(client.id)
    return Boolean(
      row && !row.revokedAt && client.allowedGrants.includes(grant),
    )
  }

  async getAllByIdentifiers(names: string[]) {
    const supported = new Set<string>(this.supportedScopes)
    return names.every((name) => supported.has(name))
      ? [...new Set(names)].map((name) => scopeEntity(name as McpScope))
      : []
  }

  async finalize(scopes: OAuthScope[]) {
    const supported = new Set<string>(this.supportedScopes)
    const names =
      scopes.length === 0 ? [MCP_READ_SCOPE] : scopes.map(({ name }) => name)
    if (names.some((name) => !supported.has(name))) {
      throw OAuthException.invalidScope(this.supportedScopes.join(' '))
    }
    return [...new Set([MCP_READ_SCOPE, ...names])].map((name) =>
      scopeEntity(name as McpScope),
    )
  }

  async getUserByCredentials(identifier: string | number) {
    return identifier === OWNER.id ? OWNER : undefined
  }

  async issueAuthCode(
    client: OAuthClient,
    user: { id: string | number } | undefined,
    scopes: OAuthScope[],
  ) {
    return {
      code: randomToken(),
      client,
      user: user ?? OWNER,
      scopes,
      expiresAt: new Date(),
    } satisfies OAuthAuthCode
  }

  async persist(code: OAuthAuthCode) {
    if (
      !code.redirectUri ||
      !code.codeChallenge ||
      code.codeChallengeMethod !== 'S256'
    ) {
      throw OAuthException.invalidGrant('Authorization code is not PKCE-bound')
    }
    await this.store.saveAuthorizationCode({
      code: code.code,
      clientId: code.client.id,
      redirectUri: code.redirectUri,
      codeChallenge: code.codeChallenge,
      codeChallengeMethod: code.codeChallengeMethod,
      scopes: code.scopes.map((scope) => scope.name),
      expiresAt: code.expiresAt,
      revokedAt: null,
    })
  }

  async getAuthorizationCode(code: string) {
    return this.store.getAuthorizationCode(code)
  }

  async getByIdentifierCode(rawCode: string) {
    const code = await this.store.getAuthorizationCode(rawCode)
    if (!code)
      throw OAuthException.invalidGrant('Authorization code is invalid')
    return this.authorizationCodeEntity(code)
  }

  private async authorizationCodeEntity(code: StoredAuthorizationCode) {
    return {
      code: code.code,
      client: await this.getByIdentifier(code.clientId),
      user: OWNER,
      redirectUri: code.redirectUri,
      codeChallenge: code.codeChallenge,
      codeChallengeMethod: code.codeChallengeMethod as 'S256',
      scopes: code.scopes.map((name) => ({ name })),
      expiresAt: code.expiresAt,
    } satisfies OAuthAuthCode
  }

  async isRevoked(rawCode: string) {
    const code = await this.store.getAuthorizationCode(rawCode)
    return !code || Boolean(code.revokedAt)
  }

  revoke(rawCodeOrToken: string | OAuthToken) {
    return typeof rawCodeOrToken === 'string'
      ? this.store.revokeAuthorizationCode(rawCodeOrToken)
      : this.store.revokeToken(rawCodeOrToken.accessToken)
  }

  async issueToken(client: OAuthClient, scopes: OAuthScope[]) {
    return {
      accessToken: randomUUID(),
      accessTokenExpiresAt: new Date(),
      client,
      user: OWNER,
      scopes,
    } satisfies OAuthToken
  }

  async issueRefreshToken(token: OAuthToken) {
    token.refreshToken = randomToken(48)
    token.refreshTokenExpiresAt = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1_000,
    )
    await this.store.attachRefreshToken(
      token.accessToken,
      token.refreshToken,
      token.refreshTokenExpiresAt,
    )
    return token
  }

  async persistToken(token: OAuthToken) {
    await this.store.saveAccessToken({
      accessTokenId: token.accessToken,
      clientId: token.client.id,
      scopes: token.scopes.map((scope) => scope.name),
      accessTokenExpiresAt: token.accessTokenExpiresAt,
      refreshToken: token.refreshToken,
      refreshTokenExpiresAt: token.refreshTokenExpiresAt,
      originatingAuthorizationCode: token.originatingAuthCodeId,
      originatingAuthorizationCodeHash: token.originatingAuthCodeId?.startsWith(
        'hash:',
      )
        ? token.originatingAuthCodeId.slice(5)
        : undefined,
      revokedAt: null,
    })
  }

  async tokenEntity(token: StoredOAuthToken) {
    return {
      accessToken: token.accessTokenId,
      accessTokenExpiresAt: token.accessTokenExpiresAt,
      refreshToken: token.refreshToken,
      refreshTokenExpiresAt: token.refreshTokenExpiresAt,
      client: await this.getByIdentifier(token.clientId),
      user: OWNER,
      scopes: token.scopes.map((name) => ({ name })),
      originatingAuthCodeId: token.originatingAuthorizationCodeHash
        ? `hash:${token.originatingAuthorizationCodeHash}`
        : token.originatingAuthorizationCode,
    } satisfies OAuthToken
  }

  async getByRefreshToken(rawToken: string) {
    const token = await this.store.getByRefreshToken(rawToken)
    if (!token) throw OAuthException.invalidGrant('Refresh token is invalid')
    return this.tokenEntity(token)
  }

  async getByAccessToken(id: string) {
    const token = await this.store.getByAccessToken(id)
    if (!token) throw OAuthException.invalidGrant('Access token is invalid')
    return this.tokenEntity(token)
  }

  async isRefreshTokenRevoked(token: OAuthToken) {
    const stored = token.refreshToken
      ? await this.store.getByRefreshToken(token.refreshToken)
      : null
    const revoked =
      !stored ||
      Boolean(stored.revokedAt) ||
      !stored.refreshTokenExpiresAt ||
      stored.refreshTokenExpiresAt <= new Date()
    if (revoked && stored?.originatingAuthorizationCodeHash) {
      await this.store.revokeTokenFamily(
        stored.originatingAuthorizationCodeHash,
      )
    }
    return revoked
  }

  async isAccessTokenRevoked(token: OAuthToken) {
    return !(await this.store.getActiveAccessToken(token.accessToken))
  }

  revokeDescendantsOf(rawCode: string) {
    return this.store.revokeDescendants(rawCode)
  }
}

// TypeScript cannot overload the two repository methods with the same names, so
// expose narrow adapters while keeping all persistence in one repository object.
export function createOAuthServer(
  config: McpConfig,
  store: OAuthStore,
  supportedScopes: readonly McpScope[] = MCP_SCOPE_VALUES,
) {
  const repositories = new CodeTendOAuthRepositories(store, supportedScopes)
  const authCodeRepository: OAuthAuthCodeRepository = {
    issueAuthCode: repositories.issueAuthCode.bind(repositories),
    persist: repositories.persist.bind(repositories),
    getByIdentifier: repositories.getByIdentifierCode.bind(repositories),
    isRevoked: repositories.isRevoked.bind(repositories),
    revoke: (code) => store.revokeAuthorizationCode(code),
  }
  const tokenRepository: OAuthTokenRepository = {
    issueToken: repositories.issueToken.bind(repositories),
    issueRefreshToken: repositories.issueRefreshToken.bind(repositories),
    persist: repositories.persistToken.bind(repositories),
    revoke: async (token) => {
      if (token.refreshToken) {
        const consumed = await store.consumeRefreshToken(token.accessToken)
        if (!consumed)
          throw OAuthException.invalidGrant('Refresh token was reused')
        return
      }
      await store.revokeToken(token.accessToken)
    },
    revokeDescendantsOf: repositories.revokeDescendantsOf.bind(repositories),
    isRefreshTokenRevoked:
      repositories.isRefreshTokenRevoked.bind(repositories),
    isAccessTokenRevoked: repositories.isAccessTokenRevoked.bind(repositories),
    getByRefreshToken: repositories.getByRefreshToken.bind(repositories),
    getByAccessToken: repositories.getByAccessToken.bind(repositories),
  }

  class CodeTendJwtService extends JwtService {
    extraTokenFields() {
      return {
        iss: config.issuer.toString(),
        aud: config.serverUrl.toString(),
      }
    }
  }

  const server = new AuthorizationServer(
    repositories,
    tokenRepository,
    repositories,
    new CodeTendJwtService(getOAuthSigningKey(config.signingSecret)),
    {
      issuer: config.issuer.toString(),
      requiresPKCE: true,
      requiresS256: true,
      authenticateRevoke: true,
      useOpaqueAuthorizationCodes: true,
      useOpaqueRefreshTokens: true,
    },
  )
  server.enableGrantType(
    {
      grant: 'authorization_code',
      authCodeRepository,
      userRepository: repositories,
    },
    new DateInterval('15m'),
  )

  return { server, repositories, owner: OWNER }
}
