import { sql } from 'drizzle-orm'
import { db } from '@/db'
import { checkEveHealth } from '@/lib/server/eve-client.server'

/** Database and Eve reachability for the `/api/health` endpoint. */
export async function getSystemHealth() {
  await db.execute(sql`select 1`)
  const eve = await checkEveHealth()
  return { status: 'ready' as const, eve }
}
