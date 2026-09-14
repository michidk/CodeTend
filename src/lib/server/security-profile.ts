import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db'
import { repositories, repositorySecurityProfiles } from '@/db/schema'

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
