import '@tanstack/react-start/server-only'

import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { repositories, scheduledRepositoryQueue } from '@/db/schema'
import { DomainError, expectReturnedRow } from '@/lib/domain-errors'
import { getServerEnv } from '@/lib/env.server'
import { validateRepositoryLocation } from '@/lib/repository-access'
import { computeNextScanAt } from '@/lib/schedule'
import type { RepositoryInput } from '@/lib/server/repositories'

export function assertRepositoryAccess(url: string): void {
  const env = getServerEnv()
  const error = validateRepositoryLocation(url, {
    allowedHosts: env.TECDEBT_ALLOWED_GIT_HOSTS.split(','),
    allowLocal: env.TECDEBT_ALLOW_LOCAL_REPOSITORIES,
    allowInsecureHttp: env.TECDEBT_ALLOW_INSECURE_GIT,
  })
  if (error) throw new DomainError('validation', error)
}

export async function insertRepository(data: RepositoryInput) {
  assertRepositoryAccess(data.url)
  const [row] = await db
    .insert(repositories)
    .values({
      ...data,
      nextScheduledScanAt:
        data.scheduleEnabled && data.scheduleCronExpression
          ? computeNextScanAt(data.scheduleCronExpression, new Date())
          : null,
    })
    .returning()
  return expectReturnedRow(row, 'Repository')
}

export type RepositoryAutomationInput =
  | { id: number; action: 'schedule'; enabled: boolean }
  | { id: number; action: 'archive' | 'restore' }

export async function updateRepositoryAutomation(
  data: RepositoryAutomationInput,
) {
  return db.transaction(async (transaction) => {
    const [current] = await transaction
      .select()
      .from(repositories)
      .where(eq(repositories.id, data.id))
      .for('update')
    if (!current) throw new DomainError('not_found', 'Repository not found')
    if (data.action === 'schedule' && data.enabled && current.archived) {
      throw new DomainError(
        'conflict',
        'Restore the repository before enabling automatic scans.',
      )
    }
    const scheduleEnabled = data.action === 'schedule' ? data.enabled : false
    const [row] = await transaction
      .update(repositories)
      .set({
        archived:
          data.action === 'schedule'
            ? current.archived
            : data.action === 'archive',
        scheduleEnabled,
        nextScheduledScanAt:
          scheduleEnabled && current.scheduleCronExpression
            ? computeNextScanAt(current.scheduleCronExpression, new Date())
            : null,
        updatedAt: new Date(),
      })
      .where(eq(repositories.id, data.id))
      .returning()
    await transaction
      .delete(scheduledRepositoryQueue)
      .where(eq(scheduledRepositoryQueue.repositoryId, data.id))
    return expectReturnedRow(row, 'Repository')
  })
}
