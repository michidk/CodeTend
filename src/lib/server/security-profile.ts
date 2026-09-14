import { createServerFn } from '@tanstack/react-start'
import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db'
import { repositories, repositorySecurityProfiles } from '@/db/schema'
import { DomainError } from '@/lib/domain-errors'
import { securityProfileSchema } from '@/lib/security-scans'

const positiveId = z.number().int().positive()

export const getRepositorySecurityProfile = createServerFn({ method: 'GET' })
  .validator(positiveId)
  .handler(async ({ data: repositoryId }) => {
    const repository = await db.query.repositories.findFirst({
      where: eq(repositories.id, repositoryId),
    })
    if (!repository) return null
    const profile = await db.query.repositorySecurityProfiles.findFirst({
      where: eq(repositorySecurityProfiles.repositoryId, repositoryId),
    })
    return { repository, profile }
  })

const updateInput = z.object({
  repositoryId: positiveId,
  profile: securityProfileSchema,
})

export const updateRepositorySecurityProfile = createServerFn({
  method: 'POST',
})
  .validator(updateInput)
  .handler(async ({ data }) => {
    const [repository] = await db
      .select({ id: repositories.id })
      .from(repositories)
      .where(eq(repositories.id, data.repositoryId))
    if (!repository) throw new DomainError('not_found', 'Repository not found')

    const [saved] = await db
      .insert(repositorySecurityProfiles)
      .values({
        repositoryId: data.repositoryId,
        profile: data.profile,
        source: 'operator',
      })
      .onConflictDoUpdate({
        target: repositorySecurityProfiles.repositoryId,
        set: {
          profile: data.profile,
          source: 'operator',
          version: sql`${repositorySecurityProfiles.version} + 1`,
          updatedAt: new Date(),
        },
      })
      .returning({ id: repositorySecurityProfiles.id })
    if (!saved) throw new Error('Failed to save security profile')
    return saved
  })
