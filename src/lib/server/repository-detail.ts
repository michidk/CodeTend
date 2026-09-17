import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db'
import {
  findingOccurrences,
  findings,
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
import {
  FINDING_SUMMARY_COLUMNS,
  FINDING_SUMMARY_RELATIONS,
} from '@/lib/server/finding-detail'
import { listGlobalScanners } from '@/lib/server/scanner-settings'
import { ensureScheduleSettingsRow } from '@/lib/server/schedule-settings'
import { ensureScheduler } from '@/lib/server/scheduler.server'

const positiveId = z.number().int().positive()
const HISTORY_LIMIT = 60

/** Scan columns the history table and timeline render; excludes large JSON. */
const SCAN_HISTORY_COLUMNS = {
  id: true,
  repositoryId: true,
  status: true,
  trigger: true,
  mode: true,
  maxFiles: true,
  fileGlob: true,
  maxInputTokens: true,
  reviewedFileCount: true,
  targetFileCount: true,
  cancellationRequestedAt: true,
  commitSha: true,
  branch: true,
  fileCount: true,
  phase: true,
  progress: true,
  gitnexusUsed: true,
  overallScore: true,
  grade: true,
  counts: true,
  model: true,
  inputTokens: true,
  outputTokens: true,
  cacheReadTokens: true,
  cacheWriteTokens: true,
  estimatedCostUsd: true,
  modelCalls: true,
  startedAt: true,
  finishedAt: true,
  createdAt: true,
} as const

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
    const scheduleSettings = await ensureScheduleSettingsRow()

    const history = await db.query.scans.findMany({
      where: eq(scans.repositoryId, repositoryId),
      orderBy: [desc(scans.createdAt)],
      limit: HISTORY_LIMIT,
      columns: SCAN_HISTORY_COLUMNS,
      with: {
        scannerRuns: {
          columns: {
            scannerId: true,
            scannerDefinition: true,
            score: true,
            status: true,
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

    const [openFindings, ignoredFindings, knowledge, configuredScanners] =
      await Promise.all([
        db.query.findings.findMany({
          where: and(
            eq(findings.repositoryId, repositoryId),
            inArray(findings.state, [...OPEN_FINDING_STATES]),
          ),
          columns: FINDING_SUMMARY_COLUMNS,
          with: FINDING_SUMMARY_RELATIONS,
        }),
        db.query.findings.findMany({
          where: and(
            eq(findings.repositoryId, repositoryId),
            isNotNull(findings.disposition),
          ),
          orderBy: [desc(findings.triagedAt)],
          columns: FINDING_SUMMARY_COLUMNS,
          with: FINDING_SUMMARY_RELATIONS,
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
        listGlobalScanners(),
      ])
    const enabledScanners = configuredScanners.filter(
      (scanner) => scanner.enabled,
    )

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

    openFindings.sort(compareFindingsBySeverity)

    return {
      repository,
      schedule: {
        enabled: scheduleSettings.enabled && repository.scheduleEnabled,
        mode:
          repository.scheduleCronExpression === null
            ? scheduleSettings.mode
            : ('cron' as const),
        scansPerDay: scheduleSettings.scansPerDay,
        cronExpression:
          repository.scheduleCronExpression ?? scheduleSettings.cronExpression,
        nextRunAt: !repository.scheduleEnabled
          ? null
          : repository.scheduleCronExpression === null
            ? scheduleSettings.nextRunAt
            : repository.nextScheduledScanAt,
        overridden: repository.scheduleCronExpression !== null,
      },
      globalSchedule: {
        enabled: scheduleSettings.enabled,
        mode: scheduleSettings.mode,
        scansPerDay: scheduleSettings.scansPerDay,
        cronExpression: scheduleSettings.cronExpression,
        nextRunAt: scheduleSettings.nextRunAt,
      },
      latestScan: latest,
      runningScan: running,
      scannerRuns: latest?.scannerRuns ?? [],
      scanners: enabledScanners,
      scannerLabels: Object.fromEntries([
        ...configuredScanners.map(
          (scanner) => [scanner.id, scanner.shortName] as const,
        ),
        ...(latest?.scannerRuns.flatMap((run) =>
          run.scannerDefinition
            ? [[run.scannerId, run.scannerDefinition.shortName] as const]
            : [],
        ) ?? []),
      ]) as Record<string, string>,
      openFindings,
      ignoredFindings,
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
        scannerDefinition: scannerRuns.scannerDefinition,
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

    const latestRunRow =
      runs.find((run) => run.status === 'completed') ?? runs[0] ?? null
    // The summary and fix prompt are large; load them for the shown run only.
    const latestRunText = latestRunRow
      ? await db.query.scannerRuns.findFirst({
          where: eq(scannerRuns.id, latestRunRow.id),
          columns: { summary: true, fixPrompt: true, error: true },
        })
      : null
    const latestRun = latestRunRow
      ? {
          ...latestRunRow,
          summary: latestRunText?.summary ?? null,
          fixPrompt: latestRunText?.fixPrompt ?? null,
          error: latestRunText?.error ?? null,
        }
      : null

    const scannerFindings = await db.query.findings.findMany({
      where: and(
        eq(findings.repositoryId, data.repositoryId),
        eq(findings.scannerId, data.scannerId),
      ),
      columns: FINDING_SUMMARY_COLUMNS,
      with: FINDING_SUMMARY_RELATIONS,
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

    const configuredScanner = (await listGlobalScanners()).find(
      (scanner) => scanner.id === data.scannerId,
    )
    const scanner = latestRunRow?.scannerDefinition ?? configuredScanner ?? null

    return {
      repository,
      scanner,
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
      columns: { manifest: false },
      with: {
        repository: { columns: { id: true, name: true } },
        // Summaries render in the table; fix prompts only on the scanner page.
        scannerRuns: { columns: { fixPrompt: false, eveSessionId: false } },
        artifacts: { columns: { kind: true, sha256: true } },
      },
    })
    if (!scan) return null
    const occurrences = await db.query.findingOccurrences.findMany({
      where: eq(findingOccurrences.scanId, scanId),
      columns: {
        id: true,
        findingId: true,
        state: true,
        severity: true,
        confidence: true,
        priority: true,
        priorityScore: true,
      },
      with: {
        finding: {
          columns: FINDING_SUMMARY_COLUMNS,
          with: FINDING_SUMMARY_RELATIONS,
        },
      },
    })
    occurrences.sort(
      (a, b) =>
        priorityRank(a.priority) - priorityRank(b.priority) ||
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
        a.finding.title.localeCompare(b.finding.title),
    )
    return { ...scan, occurrences }
  })

function priorityRank(priority: keyof typeof PRIORITY_ORDER | null): number {
  return priority ? PRIORITY_ORDER[priority] : 4
}

export function compareFindingsBySeverity(
  a: {
    severity: keyof typeof SEVERITY_ORDER
    priority: keyof typeof PRIORITY_ORDER | null
    title: string
  },
  b: {
    severity: keyof typeof SEVERITY_ORDER
    priority: keyof typeof PRIORITY_ORDER | null
    title: string
  },
): number {
  return (
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
    priorityRank(a.priority) - priorityRank(b.priority) ||
    a.title.localeCompare(b.title)
  )
}
