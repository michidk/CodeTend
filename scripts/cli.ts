/**
 * Minimal CLI for scripting the PoC without the UI:
 *   bun run scripts/cli.ts add <name> <url> [branch]
 *   bun run scripts/cli.ts due
 *   bun run scripts/cli.ts list
 */
import { eq } from 'drizzle-orm'
import { repositories, scanScheduleSettings } from '../src/db/schema'
import { db } from './database'

const [command, ...args] = process.argv.slice(2)

switch (command) {
  case 'add': {
    const [name, url, branch = 'main'] = args
    if (!name || !url) throw new Error('usage: add <name> <url> [branch]')
    const [row] = await db
      .insert(repositories)
      .values({
        name,
        url,
        branch,
      })
      .returning()
    console.log(JSON.stringify(row, null, 2))
    break
  }
  case 'due': {
    await db
      .update(scanScheduleSettings)
      .set({ nextRunAt: new Date(Date.now() - 1000) })
      .where(eq(scanScheduleSettings.id, 1))
    console.log('the global repository schedule is now due')
    break
  }
  case 'list': {
    const rows = await db.query.repositories.findMany()
    for (const row of rows) console.log(row.id, row.name, row.url, row.branch)
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
