import '@tanstack/react-start/server-only'

import { createHash } from 'node:crypto'
import { and, count, eq, gt, inArray, isNull, lt, sql } from 'drizzle-orm'
import { getDb } from '@/db'
import {
  mcpAuditEvents,
  oauthAuthorizationCodes,
  oauthClients,
  oauthTokens,
} from '@/db/schema'

// Bounds how many clients an MCP-enabled instance retains and how quickly a
// single source can register new ones, so a public, unauthenticated
// registration endpoint cannot grow the database without limit.
export const MAX_ACTIVE_OAUTH_CLIENTS = 50
export const MAX_REGISTRATIONS_PER_SOURCE = 5
export const REGISTRATION_WINDOW_MS = 60 * 60 * 1_000
export const STALE_CLIENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000

export type ClientRegistrationOutcome =
  | 'registered'
  | 'rate_limited'
  | 'capacity_reached'

export type RegistrationAdmission = {
  sourceIp: string
  maxActiveClients?: number
  maxRegistrationsPerSource?: number
  registrationWindowMs?: number
}

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
  sourceIp?: string
}

export interface OAuthStore {
  registerClient(
    client: Omit<StoredOAuthClient, 'revokedAt'>,
    admission: RegistrationAdmission,
  ): Promise<ClientRegistrationOutcome>
  pruneStaleClients(now?: Date): Promise<{ deletedClients: number }>
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
  async registerClient(
    client: Omit<StoredOAuthClient, 'revokedAt'>,
    admission: RegistrationAdmission,
  ): Promise<ClientRegistrationOutcome> {
    const maxActiveClients =
      admission.maxActiveClients ?? MAX_ACTIVE_OAUTH_CLIENTS
    const maxRegistrationsPerSource =
      admission.maxRegistrationsPerSource ?? MAX_REGISTRATIONS_PER_SOURCE
    const registrationWindowMs =
      admission.registrationWindowMs ?? REGISTRATION_WINDOW_MS

    return getDb().transaction(async (transaction) => {
      // Serializes concurrent registrations so the capacity and throttle
      // checks below are atomic with the insert they gate.
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtext('codetend-oauth-client-registration'))`,
      )

      const since = new Date(Date.now() - registrationWindowMs)
      const [recent] = await transaction
        .select({ value: count() })
        .from(mcpAuditEvents)
        .where(
          and(
            eq(mcpAuditEvents.event, 'client_registered'),
            eq(mcpAuditEvents.outcome, 'success'),
            eq(mcpAuditEvents.sourceIp, admission.sourceIp),
            gt(mcpAuditEvents.createdAt, since),
          ),
        )
      if ((recent?.value ?? 0) >= maxRegistrationsPerSource) {
        return 'rate_limited'
      }

      const [active] = await transaction
        .select({ value: count() })
        .from(oauthClients)
        .where(isNull(oauthClients.revokedAt))
      if ((active?.value ?? 0) >= maxActiveClients) {
        return 'capacity_reached'
      }

      await transaction.insert(oauthClients).values({
        id: client.id,
        name: client.name,
        redirectUris: client.redirectUris,
      })
      await transaction.insert(mcpAuditEvents).values({
        event: 'client_registered',
        outcome: 'success',
        clientId: client.id,
        sourceIp: admission.sourceIp,
      })
      return 'registered'
    })
  }

  async pruneStaleClients(now = new Date()) {
    const db = getDb()
    const retentionCutoff = new Date(now.getTime() - STALE_CLIENT_RETENTION_MS)

    // Clients that were revoked long ago, or that never completed
    // authorization (no token was ever issued) and are old enough that the
    // registering party is unlikely to return, are pruned along with their
    // audit trail so an unauthenticated registration flood cannot retain rows
    // indefinitely.
    const revokedStale = await db
      .select({ id: oauthClients.id })
      .from(oauthClients)
      .where(lt(oauthClients.revokedAt, retentionCutoff))

    const neverAuthorizedStale = await db
      .select({ id: oauthClients.id })
      .from(oauthClients)
      .leftJoin(oauthTokens, eq(oauthTokens.clientId, oauthClients.id))
      .where(
        and(
          isNull(oauthClients.revokedAt),
          isNull(oauthTokens.clientId),
          lt(oauthClients.createdAt, retentionCutoff),
        ),
      )

    const staleIds = [
      ...new Set(
        [...revokedStale, ...neverAuthorizedStale].map((client) => client.id),
      ),
    ]
    if (staleIds.length === 0) return { deletedClients: 0 }

    await db.transaction(async (transaction) => {
      await transaction
        .delete(oauthClients)
        .where(inArray(oauthClients.id, staleIds))
      await transaction
        .delete(mcpAuditEvents)
        .where(inArray(mcpAuditEvents.clientId, staleIds))
    })
    return { deletedClients: staleIds.length }
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
