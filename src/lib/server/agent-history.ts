import { createServerFn } from '@tanstack/react-start'
import { desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { findingPatches, findings, repositories } from '@/db/schema'

/** Recent fix-agent work, including queued/running jobs and published PRs. */
export const getAgentHistory = createServerFn({ method: 'GET' }).handler(
  async () =>
    db
      .select({
        id: findingPatches.id,
        status: findingPatches.status,
        findingId: findings.id,
        findingTitle: findings.title,
        scannerId: findings.scannerId,
        repositoryId: repositories.id,
        repositoryName: repositories.name,
        requestedModel: findingPatches.requestedModel,
        requestedEffort: findingPatches.requestedEffort,
        model: findingPatches.model,
        pullRequest: findingPatches.pullRequest,
        createdAt: findingPatches.createdAt,
        startedAt: findingPatches.startedAt,
        finishedAt: findingPatches.finishedAt,
      })
      .from(findingPatches)
      .innerJoin(findings, eq(findingPatches.findingId, findings.id))
      .innerJoin(repositories, eq(findings.repositoryId, repositories.id))
      .orderBy(desc(findingPatches.createdAt))
      .limit(100),
)
