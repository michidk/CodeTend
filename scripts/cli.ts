/**
 * Minimal CLI for scripting the PoC without the UI:
 *   bun run scripts/cli.ts add <name> <url> [branch] [cron]
 *   bun run scripts/cli.ts scan <repositoryId>
 *   bun run scripts/cli.ts list
 */
import { eq } from 'drizzle-orm'
import { repositories } from '../src/db/schema'
import { computeNextScanAt } from '../src/lib/schedule'
import { db } from './database'

const [command, ...args] = process.argv.slice(2)

switch (command) {
  case 'add': {
    const [name, url, branch = 'main', cron = '0 3 * * *'] = args
    if (!name || !url)
      throw new Error('usage: add <name> <url> [branch] [cron]')
    const [row] = await db
      .insert(repositories)
      .values({
        name,
        url,
        branch,
        cronExpression: cron,
        enabled: true,
        nextScanAt: computeNextScanAt(cron, new Date()),
      })
      .returning()
    console.log(JSON.stringify(row, null, 2))
    break
  }
  case 'due': {
    const id = Number(args[0])
    await db
      .update(repositories)
      .set({ nextScanAt: new Date(Date.now() - 1000) })
      .where(eq(repositories.id, id))
    console.log(`repository ${id} is now due for a scheduled scan`)
    break
  }
  case 'list': {
    const rows = await db.query.repositories.findMany()
    for (const row of rows)
      console.log(
        row.id,
        row.name,
        row.url,
        row.branch,
        row.cronExpression,
        row.nextScanAt?.toISOString(),
      )
    const recent = await db.query.scans.findMany({
      limit: 10,
      orderBy: (s, { desc }) => [desc(s.createdAt)],
    })
    for (const scan of recent)
      console.log(
        'scan',
        scan.id,
        scan.repositoryId,
        scan.status,
        scan.phase,
        scan.overallScore,
        scan.grade,
        scan.error ?? '',
      )
    break
  }
  default:
    throw new Error(`unknown command: ${command}`)
}
process.exit(0)
