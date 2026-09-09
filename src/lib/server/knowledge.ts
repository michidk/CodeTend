import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db'
import { repositories, repositoryKnowledge } from '@/db/schema'

export const getRepositoryKnowledge = createServerFn({ method: 'GET' })
  .validator(z.number().int().positive())
  .handler(async ({ data: repositoryId }) => {
    const repository = await db.query.repositories.findFirst({
      where: eq(repositories.id, repositoryId),
    })
    if (!repository) return null
    const knowledge = await db.query.repositoryKnowledge.findFirst({
      where: eq(repositoryKnowledge.repositoryId, repositoryId),
    })
    return { repository, knowledge: knowledge ?? null }
  })
