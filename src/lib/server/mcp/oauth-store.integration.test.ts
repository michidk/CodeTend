import { beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { getDb, setDatabaseForTesting } from '@/db'
import * as schema from '@/db/schema'
import { mcpAuditEvents, oauthClients, oauthTokens } from '@/db/schema'
import { DrizzleOAuthStore } from './oauth-store.server'

const enabled = process.env.RUN_DB_INTEGRATION_TESTS === 'true'

function client(name: string) {
  return {
    id: randomUUID(),
    name,
    redirectUris: ['https://client.example.com/callback'],
  }
}

describe.skipIf(!enabled)(
  'MCP OAuth client registration admission control',
  () => {
    const store = new DrizzleOAuthStore()

    beforeAll(async () => {
      setDatabaseForTesting(
        drizzle(postgres(process.env.DATABASE_URL ?? ''), { schema }),
      )
      const db = getDb()
      await db.delete(oauthTokens)
      await db.delete(mcpAuditEvents)
      await db.delete(oauthClients)
    })

    test('registers below the instance-wide active-client cap and rejects once it is reached', async () => {
      const admission = {
        sourceIp: '203.0.113.1',
        maxActiveClients: 2,
        maxRegistrationsPerSource: 100,
        registrationWindowMs: 60_000,
      }
      const first = await store.registerClient(client('first'), admission)
      const second = await store.registerClient(client('second'), admission)
      const third = await store.registerClient(client('third'), admission)

      expect(first).toBe('registered')
      expect(second).toBe('registered')
      expect(third).toBe('capacity_reached')
      expect(await getDb().select().from(oauthClients)).toHaveLength(2)
    })

    test('throttles repeated registrations from the same source independently of other sources', async () => {
      await getDb().delete(mcpAuditEvents)
      await getDb().delete(oauthClients)

      const admission = {
        sourceIp: '198.51.100.7',
        maxActiveClients: 100,
        maxRegistrationsPerSource: 2,
        registrationWindowMs: 60_000,
      }
      const first = await store.registerClient(client('flood-1'), admission)
      const second = await store.registerClient(client('flood-2'), admission)
      const third = await store.registerClient(client('flood-3'), admission)
      const fromAnotherSource = await store.registerClient(
        client('other-source'),
        {
          ...admission,
          sourceIp: '198.51.100.8',
        },
      )

      expect(first).toBe('registered')
      expect(second).toBe('registered')
      expect(third).toBe('rate_limited')
      expect(fromAnotherSource).toBe('registered')
      expect(await getDb().select().from(oauthClients)).toHaveLength(3)
    })

    test('prunes revoked clients and never-authorized clients past retention, keeping recent and active ones', async () => {
      await getDb().delete(oauthTokens)
      await getDb().delete(mcpAuditEvents)
      await getDb().delete(oauthClients)

      const db = getDb()
      const old = new Date('2020-01-01T00:00:00Z')
      const recent = new Date()

      const [staleRevoked] = await db
        .insert(oauthClients)
        .values({
          id: randomUUID(),
          name: 'stale revoked',
          redirectUris: ['https://client.example.com/callback'],
          revokedAt: old,
          createdAt: old,
        })
        .returning({ id: oauthClients.id })
      const [staleNeverAuthorized] = await db
        .insert(oauthClients)
        .values({
          id: randomUUID(),
          name: 'stale never authorized',
          redirectUris: ['https://client.example.com/callback'],
          createdAt: old,
        })
        .returning({ id: oauthClients.id })
      const [recentlyRevoked] = await db
        .insert(oauthClients)
        .values({
          id: randomUUID(),
          name: 'recently revoked',
          redirectUris: ['https://client.example.com/callback'],
          revokedAt: recent,
          createdAt: old,
        })
        .returning({ id: oauthClients.id })
      const [staleWithToken] = await db
        .insert(oauthClients)
        .values({
          id: randomUUID(),
          name: 'stale but authorized',
          redirectUris: ['https://client.example.com/callback'],
          createdAt: old,
        })
        .returning({ id: oauthClients.id })
      if (
        !staleRevoked ||
        !staleNeverAuthorized ||
        !recentlyRevoked ||
        !staleWithToken
      ) {
        throw new Error('Seed clients were not created')
      }
      await db.insert(oauthTokens).values({
        accessTokenId: randomUUID(),
        clientId: staleWithToken.id,
        scopes: ['codetend:read'],
        accessTokenExpiresAt: new Date(Date.now() + 60_000),
      })
      await db.insert(mcpAuditEvents).values([
        {
          event: 'client_registered',
          outcome: 'success',
          clientId: staleRevoked.id,
        },
        {
          event: 'client_registered',
          outcome: 'success',
          clientId: staleWithToken.id,
        },
      ])

      const result = await store.pruneStaleClients(
        new Date('2026-01-01T00:00:00Z'),
      )
      expect(result.deletedClients).toBe(2)

      const remainingIds = new Set(
        (await db.select({ id: oauthClients.id }).from(oauthClients)).map(
          (row) => row.id,
        ),
      )
      expect(remainingIds.has(recentlyRevoked.id)).toBe(true)
      expect(remainingIds.has(staleWithToken.id)).toBe(true)
      expect(remainingIds.has(staleRevoked.id)).toBe(false)
      expect(remainingIds.has(staleNeverAuthorized.id)).toBe(false)

      // Audit rows for a pruned client are removed with it; other clients' rows survive.
      const remainingAudit = await db
        .select({ clientId: mcpAuditEvents.clientId })
        .from(mcpAuditEvents)
      expect(
        remainingAudit.some((row) => row.clientId === staleRevoked.id),
      ).toBe(false)
      expect(
        remainingAudit.some((row) => row.clientId === staleWithToken.id),
      ).toBe(true)
    })

    test('getClient still resolves a registered client by id', async () => {
      await getDb().delete(oauthClients)
      const created = client('lookup target')
      await store.registerClient(created, { sourceIp: '203.0.113.9' })
      const found = await store.getClient(created.id)
      expect(found?.name).toBe('lookup target')
      expect(
        await store.getClient('00000000-0000-0000-0000-000000000000'),
      ).toBeNull()
      expect(
        await getDb()
          .select()
          .from(oauthClients)
          .where(eq(oauthClients.id, created.id)),
      ).toHaveLength(1)
    })
  },
)
