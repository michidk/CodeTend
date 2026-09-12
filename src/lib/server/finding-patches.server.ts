import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm'
import { db } from '@/db'
import { findingPatches, findings, scans } from '@/db/schema'
import { DomainError, expectReturnedRow } from '@/lib/domain-errors'
import { getServerEnv } from '@/lib/env.server'
import { OPEN_FINDING_STATES } from '@/lib/findings'
import {
  cancelEveScanSession,
  startEvePatchSession,
} from '@/lib/server/eve-client.server'
import {
  readPatchResult,
  removePatchArtifacts,
  removePatchWorkspace,
  waitForPatchResult,
  writePatchRequest,
} from '@/lib/server/scan-files.server'
import {
  readScanUsage,
  removeScanUsage,
  usageColumns,
} from '@/lib/server/scan-usage.server'

const PATCH_TIMEOUT_MS = 60 * 60_000

export async function generateFindingPatchImpl(findingId: number) {
  const finding = await db.query.findings.findFirst({
    where: eq(findings.id, findingId),
    with: { repository: true },
  })
  if (!finding) throw new DomainError('not_found', 'Finding not found')
  if (!OPEN_FINDING_STATES.includes(finding.state) || finding.disposition) {
    throw new DomainError(
      'conflict',
      'Only active, non-disposed findings can be patched.',
    )
  }
  const existing = await db.query.findingPatches.findFirst({
    where: and(
      eq(findingPatches.findingId, findingId),
      inArray(findingPatches.status, ['generating', 'proposed', 'verified']),
    ),
    orderBy: [desc(findingPatches.createdAt)],
  })
  if (existing) {
    throw new DomainError(
      'conflict',
      'Review or reject the current patch before generating another.',
    )
  }
  const env = getServerEnv()
  const [capacity] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(findingPatches)
    .where(eq(findingPatches.status, 'generating'))
  if ((capacity?.count ?? 0) >= env.TECDEBT_MAX_ACTIVE_PATCHES) {
    throw new DomainError(
      'conflict',
      'Patch capacity is full. Try again after a running patch finishes.',
    )
  }
  if (env.TECDEBT_MAX_DAILY_COST_USD !== undefined) {
    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)
    const [[scanUsage], [patchUsage]] = await Promise.all([
      db
        .select({
          cost: sql<number>`coalesce(sum(${scans.estimatedCostUsd}), 0)::float8`,
        })
        .from(scans)
        .where(gte(scans.createdAt, today)),
      db
        .select({
          cost: sql<number>`coalesce(sum(${findingPatches.estimatedCostUsd}), 0)::float8`,
        })
        .from(findingPatches)
        .where(gte(findingPatches.createdAt, today)),
    ])
    if (
      (scanUsage?.cost ?? 0) + (patchUsage?.cost ?? 0) >=
      env.TECDEBT_MAX_DAILY_COST_USD
    ) {
      throw new DomainError(
        'conflict',
        'The daily AI-cost budget has been reached.',
      )
    }
  }
  const sourceScan = finding.lastSeenScanId
    ? await db.query.scans.findFirst({
        where: and(
          eq(scans.id, finding.lastSeenScanId),
          eq(scans.repositoryId, finding.repositoryId),
        ),
        columns: { id: true, commitSha: true },
      })
    : null
  if (!sourceScan?.commitSha) {
    throw new DomainError(
      'conflict',
      'The finding has no completed source revision.',
    )
  }
  let patch: typeof findingPatches.$inferSelect | undefined
  try {
    const inserted = await db
      .insert(findingPatches)
      .values({
        findingId,
        sourceScanId: sourceScan.id,
        status: 'generating',
        diff: '',
        summary: 'Generating a minimal patch in a disposable clone.',
      })
      .returning()
    patch = inserted[0]
  } catch (error) {
    if (postgresErrorCode(error) === '23505') {
      throw new DomainError(
        'conflict',
        'Review or reject the current patch before generating another.',
      )
    }
    throw error
  }
  const created = expectReturnedRow(patch, 'Patch')
  try {
    await writePatchRequest({
      patchId: created.id,
      repositoryId: finding.repositoryId,
      repositoryName: finding.repository.name,
      repositoryUrl: finding.repository.url,
      branch: finding.repository.branch,
      revision: sourceScan.commitSha,
      finding: {
        id: finding.id,
        title: finding.title,
        severity: finding.severity,
        description: finding.description,
        rootCause: finding.rootCause,
        whyItMatters: finding.whyItMatters,
        recommendation: finding.recommendation,
        locations: finding.locations,
        codeEvidence: finding.codeEvidence,
        validationPlan: finding.validationPlan,
        remediationTests: finding.remediationTests,
        preventiveControls: finding.preventiveControls,
      },
      validation: {
        enabled: env.TECDEBT_VALIDATION_ENABLED,
        runner: env.TECDEBT_VALIDATION_RUNNER,
        image: env.TECDEBT_VALIDATION_IMAGE,
      },
    })
  } catch (error) {
    await failPatch(created.id, error)
    throw error
  }
  void runPatchPipeline(created.id, finding.repositoryId).catch((error) =>
    console.error(`[CodeTend] patch ${created.id} crashed`, error),
  )
  return { patchId: created.id }
}

export async function decideFindingPatchImpl(data: {
  readonly patchId: number
  readonly decision: 'accepted' | 'rejected'
}) {
  const patch = await db.query.findingPatches.findFirst({
    where: eq(findingPatches.id, data.patchId),
    with: { finding: true },
  })
  if (!patch) throw new DomainError('not_found', 'Patch not found')
  if (!['proposed', 'verified'].includes(patch.status)) {
    throw new DomainError('conflict', 'This patch is not awaiting review.')
  }
  if (
    data.decision === 'accepted' &&
    (!OPEN_FINDING_STATES.includes(patch.finding.state) ||
      patch.finding.disposition)
  ) {
    throw new DomainError(
      'conflict',
      'Only active, non-disposed findings can have a patch approved.',
    )
  }
  const [updated] = await db
    .update(findingPatches)
    .set({ status: data.decision, updatedAt: new Date() })
    .where(
      and(
        eq(findingPatches.id, data.patchId),
        inArray(findingPatches.status, ['proposed', 'verified']),
      ),
    )
    .returning({ id: findingPatches.id, status: findingPatches.status })
  if (!updated) {
    throw new DomainError(
      'conflict',
      'This patch is no longer awaiting review.',
    )
  }
  return updated
}

export async function getFindingPatch(patchId: number) {
  return db.query.findingPatches.findFirst({
    where: eq(findingPatches.id, patchId),
  })
}

async function runPatchPipeline(patchId: number, repositoryId: number) {
  try {
    const session = await startEvePatchSession(patchId)
    const attached = await db
      .update(findingPatches)
      .set({ eveSessionId: session.sessionId, updatedAt: new Date() })
      .where(
        and(
          eq(findingPatches.id, patchId),
          eq(findingPatches.status, 'generating'),
        ),
      )
      .returning({ id: findingPatches.id })
    if (attached.length === 0) {
      await cancelEveScanSession(session.sessionId).catch(() => undefined)
      return
    }
    const outcome = await Promise.race([
      session.settle(async () => undefined),
      waitForPatchResult(patchId, PATCH_TIMEOUT_MS).then(() => null),
    ])
    const result = await readPatchResult(patchId)
    if (!result) {
      throw new Error(
        outcome?.failure ??
          `Eve finished with status "${outcome?.status ?? 'unknown'}" but wrote no patch result.`,
      )
    }
    await persistPatchResult(patchId, result)
  } catch (error) {
    await failPatch(patchId, error)
  } finally {
    await cleanupPatchFiles(repositoryId, patchId)
  }
}

async function persistPatchResult(
  patchId: number,
  result: NonNullable<Awaited<ReturnType<typeof readPatchResult>>>,
) {
  const patch = await db.query.findingPatches.findFirst({
    where: eq(findingPatches.id, patchId),
    columns: { eveSessionId: true },
    with: { finding: true },
  })
  if (!patch) return
  const usage = patch.eveSessionId
    ? await readScanUsage(patch.eveSessionId)
    : null
  if (
    !OPEN_FINDING_STATES.includes(patch.finding.state) ||
    patch.finding.disposition
  ) {
    await db
      .update(findingPatches)
      .set({
        status: 'failed',
        diff: '',
        summary:
          'The generated patch was discarded because the finding is no longer active and non-disposed.',
        model: usage?.model ?? null,
        ...usageColumns(usage?.total),
        updatedAt: new Date(),
      })
      .where(eq(findingPatches.id, patchId))
    return
  }
  const verification = result.verification
    ? {
        status: result.verification.status,
        commands: result.verification.commands,
        proofGaps: result.verification.proofGaps,
      }
    : null
  await db
    .update(findingPatches)
    .set({
      status: result.status,
      diff: result.diff,
      summary: [
        result.summary,
        result.changedFiles.length
          ? `Changed files: ${result.changedFiles.join(', ')}`
          : '',
        result.testRecommendations.length
          ? `Recommended tests: ${result.testRecommendations.join('; ')}`
          : '',
        result.error ? `Error: ${result.error}` : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
      verification,
      model: usage?.model ?? null,
      ...usageColumns(usage?.total),
      updatedAt: new Date(result.finishedAt),
    })
    .where(eq(findingPatches.id, patchId))
}

async function failPatch(patchId: number, error: unknown) {
  const patch = await db.query.findingPatches.findFirst({
    where: eq(findingPatches.id, patchId),
    columns: { eveSessionId: true },
  })
  const usage = patch?.eveSessionId
    ? await readScanUsage(patch.eveSessionId)
    : null
  await db
    .update(findingPatches)
    .set({
      status: 'failed',
      summary: `Patch generation failed: ${error instanceof Error ? error.message : String(error)}`,
      model: usage?.model ?? null,
      ...usageColumns(usage?.total),
      updatedAt: new Date(),
    })
    .where(eq(findingPatches.id, patchId))
}

async function cleanupPatchFiles(repositoryId: number, patchId: number) {
  const patch = await db.query.findingPatches.findFirst({
    where: eq(findingPatches.id, patchId),
    columns: { eveSessionId: true },
  })
  await Promise.allSettled([
    removePatchWorkspace(repositoryId, patchId),
    removePatchArtifacts(patchId),
    ...(patch?.eveSessionId ? [removeScanUsage(patch.eveSessionId)] : []),
  ])
}

export async function recoverInterruptedPatches(): Promise<void> {
  const generating = await db.query.findingPatches.findMany({
    where: eq(findingPatches.status, 'generating'),
    with: { finding: true },
  })
  for (const patch of generating) {
    const recovery = patch.eveSessionId
      ? adoptPatch(patch.id, patch.finding.repositoryId, patch.createdAt)
      : runPatchPipeline(patch.id, patch.finding.repositoryId)
    void recovery.catch((error) =>
      console.error(`[CodeTend] failed to recover patch ${patch.id}`, error),
    )
  }
}

function postgresErrorCode(error: unknown): string | undefined {
  let current: unknown = error
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== 'object' || current === null) return undefined
    const record = current as { code?: unknown; cause?: unknown }
    if (typeof record.code === 'string') return record.code
    current = record.cause
  }
  return undefined
}

async function adoptPatch(
  patchId: number,
  repositoryId: number,
  createdAt: Date,
) {
  try {
    let result = await readPatchResult(patchId)
    if (!result) {
      const remaining = PATCH_TIMEOUT_MS - (Date.now() - createdAt.getTime())
      if (remaining <= 0)
        throw new Error('Patch generation expired during restart.')
      await waitForPatchResult(patchId, remaining)
      result = await readPatchResult(patchId)
    }
    if (!result) throw new Error('Patch result file disappeared.')
    await persistPatchResult(patchId, result)
  } catch (error) {
    await failPatch(patchId, error)
  } finally {
    await cleanupPatchFiles(repositoryId, patchId)
  }
}
