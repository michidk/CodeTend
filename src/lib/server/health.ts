import { readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sql } from 'drizzle-orm'
import { db } from '@/db'
import { checkEveHealth } from '@/lib/server/eve-client.server'

/** Database and Eve reachability for the `/api/health` endpoint. */
export async function getSystemHealth() {
  await db.execute(sql`select 1`)
  const [eve, migrations] = await Promise.all([
    checkEveHealth(),
    migrationHealth(),
  ])
  if (!eve.ok || migrations.applied !== migrations.expected) {
    throw new Error('System dependencies are not ready')
  }
  return { status: 'ready' as const, eve, migrations }
}

async function migrationHealth() {
  const files = await readdir(resolve(process.cwd(), 'drizzle'))
  const expected = files.filter((file) => /^\d+_.+\.sql$/.test(file)).length
  const rows = await db.execute(
    sql`select count(*)::int as applied from drizzle.__drizzle_migrations`,
  )
  const applied = Number(
    (rows[0] as { applied?: unknown } | undefined)?.applied,
  )
  if (!Number.isInteger(applied)) throw new Error('Migration state is invalid')
  return { applied, expected }
}
