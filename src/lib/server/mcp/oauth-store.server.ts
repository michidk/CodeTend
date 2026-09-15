import '@tanstack/react-start/server-only'

import { createHash } from 'node:crypto'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { getDb } from '@/db'
import {
  mcpAuditEvents,
  oauthAuthorizationCodes,
  oauthClients,
  oauthTokens,
} from '@/db/schema'

export type StoredOAuthClient = {
  id: string
  name: string
  redirectUris: string[]
  revokedAt: Date | null
}

export type StoredAuthorizationCode = {
  code: string
  clientId: string
  redirectUri: string
  codeChallenge: string
  codeChallengeMethod: string
  scopes: string[]
  expiresAt: Date
  revokedAt: Date | null
}

export type StoredOAuthToken = {
  accessTokenId: string
  clientId: string
  scopes: string[]
  accessTokenExpiresAt: Date
  refreshToken?: string | null
  refreshTokenExpiresAt?: Date | null
  originatingAuthorizationCode?: string
  originatingAuthorizationCodeHash?: string | null
  revokedAt: Date | null
}

export type OAuthAuditEvent = {
  event: string
  outcome: 'success' | 'failure' | 'denied'
  clientId?: string
  toolName?: string
}

export interface OAuthStore {
  createClient(client: Omit<StoredOAuthClient, 'revokedAt'>): Promise<void>
  getClient(id: string): Promise<StoredOAuthClient | null>
  saveAuthorizationCode(code: StoredAuthorizationCode): Promise<void>
  getAuthorizationCode(rawCode: string): Promise<StoredAuthorizationCode | null>
  revokeAuthorizationCode(rawCode: string): Promise<void>
  saveAccessToken(token: StoredOAuthToken): Promise<void>
  attachRefreshToken(
    accessTokenId: string,
    rawRefreshToken: string,
    expiresAt: Date,
  ): Promise<void>
  getByRefreshToken(rawRefreshToken: string): Promise<StoredOAuthToken | null>
  getByAccessToken(accessTokenId: string): Promise<StoredOAuthToken | null>
  getActiveAccessToken(accessTokenId: string): Promise<StoredOAuthToken | null>
  revokeToken(accessTokenId: string): Promise<void>
  consumeRefreshToken(accessTokenId: string): Promise<boolean>
  revokeTokenFamily(authorizationCodeHash: string): Promise<void>
  revokeDescendants(rawAuthorizationCode: string): Promise<void>
  audit(event: OAuthAuditEvent): Promise<void>
}

export function hashOAuthSecret(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

export class DrizzleOAuthStore implements OAuthStore {
  async createClient(client: Omit<StoredOAuthClient, 'revokedAt'>) {
    await getDb().insert(oauthClients).values({
      id: client.id,
      name: client.name,
      redirectUris: client.redirectUris,
    })
  }

  async getClient(id: string) {
    const [row] = await getDb()
      .select()
      .from(oauthClients)
      .where(eq(oauthClients.id, id))
    return row ?? null
  }

  async saveAuthorizationCode(code: StoredAuthorizationCode) {
    await getDb()
      .insert(oauthAuthorizationCodes)
      .values({
        codeHash: hashOAuthSecret(code.code),
        clientId: code.clientId,
        redirectUri: code.redirectUri,
        codeChallenge: code.codeChallenge,
        codeChallengeMethod: code.codeChallengeMethod,
        scopes: code.scopes,
        expiresAt: code.expiresAt,
        revokedAt: code.revokedAt,
      })
  }

  async getAuthorizationCode(rawCode: string) {
    const [row] = await getDb()
      .select()
      .from(oauthAuthorizationCodes)
      .where(eq(oauthAuthorizationCodes.codeHash, hashOAuthSecret(rawCode)))
    return row ? { ...row, code: rawCode } : null
  }

  async revokeAuthorizationCode(rawCode: string) {
    await getDb()
      .update(oauthAuthorizationCodes)
      .set({ revokedAt: new Date() })
      .where(eq(oauthAuthorizationCodes.codeHash, hashOAuthSecret(rawCode)))
  }

  async saveAccessToken(token: StoredOAuthToken) {
    await getDb()
      .insert(oauthTokens)
      .values({
        accessTokenId: token.accessTokenId,
        clientId: token.clientId,
        scopes: token.scopes,
        accessTokenExpiresAt: token.accessTokenExpiresAt,
        refreshTokenHash: token.refreshToken
          ? hashOAuthSecret(token.refreshToken)
          : null,
        refreshTokenExpiresAt: token.refreshTokenExpiresAt,
        originatingAuthorizationCodeHash:
          token.originatingAuthorizationCodeHash ??
          (token.originatingAuthorizationCode
            ? hashOAuthSecret(token.originatingAuthorizationCode)
            : null),
        revokedAt: token.revokedAt,
      })
  }

  async attachRefreshToken(
    accessTokenId: string,
    rawRefreshToken: string,
    expiresAt: Date,
  ) {
    await getDb()
      .update(oauthTokens)
      .set({
        refreshTokenHash: hashOAuthSecret(rawRefreshToken),
        refreshTokenExpiresAt: expiresAt,
      })
      .where(eq(oauthTokens.accessTokenId, accessTokenId))
  }

  private async tokenWhere(
    where: ReturnType<typeof eq>,
    rawRefreshToken?: string,
  ) {
    const [row] = await getDb().select().from(oauthTokens).where(where)
    if (!row) return null
    return {
      ...row,
      refreshToken: rawRefreshToken,
      originatingAuthorizationCodeHash: row.originatingAuthorizationCodeHash,
    }
  }

  getByRefreshToken(rawRefreshToken: string) {
    return this.tokenWhere(
      eq(oauthTokens.refreshTokenHash, hashOAuthSecret(rawRefreshToken)),
      rawRefreshToken,
    )
  }

  getByAccessToken(accessTokenId: string) {
    return this.tokenWhere(eq(oauthTokens.accessTokenId, accessTokenId))
  }

  async getActiveAccessToken(accessTokenId: string) {
    const [row] = await getDb()
      .select()
      .from(oauthTokens)
      .where(
        and(
          eq(oauthTokens.accessTokenId, accessTokenId),
          isNull(oauthTokens.revokedAt),
          gt(oauthTokens.accessTokenExpiresAt, new Date()),
        ),
      )
    return row
      ? {
          ...row,
          originatingAuthorizationCodeHash:
            row.originatingAuthorizationCodeHash,
        }
      : null
  }

  async revokeToken(accessTokenId: string) {
    await getDb()
      .update(oauthTokens)
      .set({ revokedAt: new Date() })
      .where(eq(oauthTokens.accessTokenId, accessTokenId))
  }

  async consumeRefreshToken(accessTokenId: string) {
    const rows = await getDb()
      .update(oauthTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(oauthTokens.accessTokenId, accessTokenId),
          isNull(oauthTokens.revokedAt),
          gt(oauthTokens.refreshTokenExpiresAt, new Date()),
        ),
      )
      .returning({ id: oauthTokens.accessTokenId })
    return rows.length === 1
  }

  async revokeTokenFamily(authorizationCodeHash: string) {
    await getDb()
      .update(oauthTokens)
      .set({ revokedAt: new Date() })
      .where(
        eq(oauthTokens.originatingAuthorizationCodeHash, authorizationCodeHash),
      )
  }

  async revokeDescendants(rawAuthorizationCode: string) {
    await getDb()
      .update(oauthTokens)
      .set({ revokedAt: new Date() })
      .where(
        eq(
          oauthTokens.originatingAuthorizationCodeHash,
          hashOAuthSecret(rawAuthorizationCode),
        ),
      )
  }

  async audit(event: OAuthAuditEvent) {
    await getDb().insert(mcpAuditEvents).values(event)
  }
}
