import { createServerFn } from '@tanstack/react-start'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db'
import {
  findingOccurrences,
  findingPatches,
  findings,
  findingValidations,
  repositories,
  repositoryKnowledge,
  scannerRuns,
  scans,
} from '@/db/schema'
import {
  OPEN_FINDING_STATES,
  PRIORITY_ORDER,
  SEVERITY_ORDER,
} from '@/lib/findings'
import { enabledScanners } from '@/lib/scanners'
import { ensureScheduler } from '@/lib/server/scheduler.server'

const positiveId = z.number().int().positive()
const HISTORY_LIMIT = 60

/**
 * Everything the repository page needs: the latest scored scan with its
 * scanner runs, open findings, scan history and the time series for the
 * "change over time" charts.
 */
export const getRepositoryDetail = createServerFn({ method: 'GET' })
  .validator(positiveId)
  .handler(async ({ data: repositoryId }) => {
    ensureScheduler()
    const repository = await db.query.repositories.findFirst({
      where: eq(repositories.id, repositoryId),
    })
    if (!repository) return null

    const history = await db.query.scans.findMany({
      where: eq(scans.repositoryId, repositoryId),
      orderBy: [desc(scans.createdAt)],
      limit: HISTORY_LIMIT,
      with: {
        scannerRuns: {
          columns: {
            scannerId: true,
            score: true,
            status: true,
            summary: true,
          },
        },
      },
    })

    const latest =
      history.find(
        (scan) => scan.status === 'completed' || scan.status === 'partial',
      ) ?? null
    const running =
      history.find(
        (scan) => scan.status === 'queued' || scan.status === 'running',
      ) ?? null

    const [openFindings, knowledge] = await Promise.all([
      db.query.findings.findMany({
        where: and(
          eq(findings.repositoryId, repositoryId),
          inArray(findings.state, [...OPEN_FINDING_STATES]),
        ),
        with: {
          validations: {
            orderBy: [desc(findingValidations.createdAt)],
            limit: 1,
          },
          patches: {
            orderBy: [desc(findingPatches.createdAt)],
            limit: 3,
          },
        },
      }),
      db.query.repositoryKnowledge.findFirst({
        where: eq(repositoryKnowledge.repositoryId, repositoryId),
        columns: {
          summary: true,
          refreshedAt: true,
          commitSha: true,
          fileCount: true,
          sources: true,
        },
      }),
    ])

    const scored = history
      .filter(
        (scan) => scan.status === 'completed' || scan.status === 'partial',
      )
      .reverse()

    const activeFindingCounts = await activeFindingsPerScan(
      scored.map((scan) => scan.id),
    )

    const timeline = scored.map((scan) => ({
      scanId: scan.id,
      at: (scan.finishedAt ?? scan.createdAt).toISOString(),
      overallScore: scan.overallScore,
      activeFindings: activeFindingCounts.get(scan.id) ?? 0,
      scanners: Object.fromEntries(
        scan.scannerRuns.map((run) => [run.scannerId, run.score]),
      ) as Record<string, number | null>,
    }))

    openFindings.sort(
      (a, b) =>
        priorityRank(a.priority) - priorityRank(b.priority) ||
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
        a.title.localeCompare(b.title),
    )

    return {
      repository,
      latestScan: latest,
      runningScan: running,
      scannerRuns: latest?.scannerRuns ?? [],
      openFindings,
      openFindingsByScanner: Object.fromEntries(
        enabledScanners.map((scanner) => [
          scanner.id,
          openFindings.filter((finding) => finding.scannerId === scanner.id)
            .length,
        ]),
      ) as Record<string, number>,
      history: history.map(({ scannerRuns: runs, ...scan }) => ({
        ...scan,
        completedScanners: runs.filter((run) => run.status === 'completed')
          .length,
        failedScanners: runs.filter((run) => run.status === 'failed').length,
      })),
      timeline,
      knowledge: knowledge
        ? {
            ...knowledge,
            sourceCount: knowledge.sources.length,
            sources: undefined,
          }
        : null,
    }
  })

export type RepositoryDetail = NonNullable<
  Awaited<ReturnType<typeof getRepositoryDetail>>
>

/**
 * Number of findings that were open right after each scan: occurrences of
 * that scan whose state is not resolved.
 */
async function activeFindingsPerScan(
  scanIds: number[],
): Promise<Map<number, number>> {
  if (scanIds.length === 0) return new Map()
  const rows = await db
    .select({
      scanId: findingOccurrences.scanId,
      state: findingOccurrences.state,
    })
    .from(findingOccurrences)
    .where(inArray(findingOccurrences.scanId, scanIds))
  const counts = new Map<number, number>()
  for (const row of rows) {
    if (row.state === 'resolved') continue
    counts.set(row.scanId, (counts.get(row.scanId) ?? 0) + 1)
  }
  return counts
}

export const getScannerDetail = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      repositoryId: positiveId,
      scannerId: z.string().min(1).max(60),
    }),
  )
  .handler(async ({ data }) => {
    const repository = await db.query.repositories.findFirst({
      where: eq(repositories.id, data.repositoryId),
    })
    if (!repository) return null

    const runs = await db
      .select({
        id: scannerRuns.id,
        scanId: scannerRuns.scanId,
        score: scannerRuns.score,
        status: scannerRuns.status,
        summary: scannerRuns.summary,
        fixPrompt: scannerRuns.fixPrompt,
        error: scannerRuns.error,
        finishedAt: scannerRuns.finishedAt,
        scanCreatedAt: scans.createdAt,
        scanStatus: scans.status,
        commitSha: scans.commitSha,
      })
      .from(scannerRuns)
      .innerJoin(scans, eq(scannerRuns.scanId, scans.id))
      .where(
        and(
          eq(scans.repositoryId, data.repositoryId),
          eq(scannerRuns.scannerId, data.scannerId),
        ),
      )
      .orderBy(desc(scans.createdAt))
      .limit(HISTORY_LIMIT)

    const latestRun =
      runs.find((run) => run.status === 'completed') ?? runs[0] ?? null

    const scannerFindings = await db.query.findings.findMany({
      where: and(
        eq(findings.repositoryId, data.repositoryId),
        eq(findings.scannerId, data.scannerId),
      ),
      with: {
        occurrences: {
          orderBy: [asc(findingOccurrences.createdAt)],
          columns: {
            scanId: true,
            state: true,
            severity: true,
            note: true,
            createdAt: true,
          },
        },
        validations: {
          orderBy: [desc(findingValidations.createdAt)],
          limit: 1,
        },
        patches: {
          orderBy: [desc(findingPatches.createdAt)],
          limit: 3,
        },
      },
    })

    const open = scannerFindings
      .filter((finding) => OPEN_FINDING_STATES.includes(finding.state))
      .sort(
        (a, b) =>
          priorityRank(a.priority) - priorityRank(b.priority) ||
          SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
      )
    const resolved = scannerFindings
      .filter((finding) => finding.state === 'resolved')
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, 25)

    return {
      repository,
      latestRun,
      runs: runs
        .filter((run) => run.status === 'completed')
        .reverse()
        .map((run) => ({
          scanId: run.scanId,
          at: (run.finishedAt ?? run.scanCreatedAt).toISOString(),
          score: run.score,
        })),
      openFindings: open,
      resolvedFindings: resolved,
    }
  })

export const getScanDetail = createServerFn({ method: 'GET' })
  .validator(positiveId)
  .handler(async ({ data: scanId }) => {
    const scan = await db.query.scans.findFirst({
      where: eq(scans.id, scanId),
      with: { repository: true, scannerRuns: true, artifacts: true },
    })
    if (!scan) return null
    const occurrences = await db.query.findingOccurrences.findMany({
      where: eq(findingOccurrences.scanId, scanId),
      with: {
        finding: {
          with: {
            patches: {
              orderBy: [desc(findingPatches.createdAt)],
              limit: 3,
            },
          },
        },
      },
    })
    const occurrenceIds = occurrences.map((occurrence) => occurrence.id)
    const validations =
      occurrenceIds.length > 0
        ? await db.query.findingValidations.findMany({
            where: inArray(findingValidations.occurrenceId, occurrenceIds),
            orderBy: [desc(findingValidations.createdAt)],
          })
        : []
    occurrences.sort(
      (a, b) =>
        priorityRank(a.priority) - priorityRank(b.priority) ||
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
        a.finding.title.localeCompare(b.finding.title),
    )
    return {
      ...scan,
      occurrences: occurrences.map((occurrence) => ({
        ...occurrence,
        validations: validations.filter(
          (validation) => validation.occurrenceId === occurrence.id,
        ),
      })),
    }
  })

function priorityRank(priority: keyof typeof PRIORITY_ORDER | null): number {
  return priority ? PRIORITY_ORDER[priority] : 4
}
