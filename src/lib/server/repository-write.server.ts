import '@tanstack/react-start/server-only'

import { db } from '@/db'
import { repositories } from '@/db/schema'
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
