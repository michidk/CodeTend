import '@tanstack/react-start/server-only'

import { and, eq, inArray, lt } from 'drizzle-orm'
import { db } from '@/db'
import {
  type FindingCounts,
  findings,
  type Repository,
  repositories,
  repositoryKnowledge,
  type ScanTrigger,
  scannerRuns,
  scans,
} from '@/db/schema'
import { getServerEnv } from '@/lib/env.server'
import {
  OPEN_FINDING_STATES,
  type ScannerResult,
  scannerResultJsonSchema,
} from '@/lib/findings'
import { buildFixPrompt } from '@/lib/fix-prompt'
import { enabledScanners, getScanner } from '@/lib/scanners'
import { computeNextScanAt } from '@/lib/schedule'
import {
  calculateOverallScore,
  calculateScannerScore,
  gradeForScore,
} from '@/lib/scoring'
import { runEveScanSession } from '@/lib/server/eve-client.server'
import {
  reconcileScannerFindings,
  sumCounts,
} from '@/lib/server/finding-reconciliation.server'
import { ensureGitNexusServer } from '@/lib/server/gitnexus.server'
import {
  readScanResult,
  removeScanWorkspace,
  writeScanRequest,
} from '@/lib/server/scan-files.server'

const ACTIVE_SCAN_STATUSES = ['queued', 'running'] as const

/**
 * Creates a scan row for a repository and starts the pipeline in the
 * background. Returns null when a scan is already active for the repository,
 * which is how concurrent scans of the same repository are prevented.
 */
export async function startScan(
  repositoryId: number,
  trigger: ScanTrigger,
): Promise<number | null> {
  const repository = await db.query.repositories.findFirst({
    where: eq(repositories.id, repositoryId),
  })
  if (!repository) throw new Error('Repository not found')

  const active = await db.query.scans.findFirst({
    where: and(
      eq(scans.repositoryId, repositoryId),
      inArray(scans.status, [...ACTIVE_SCAN_STATUSES]),
    ),
  })
  if (active) return null

  const [scan] = await db
    .insert(scans)
    .values({
      repositoryId,
      trigger,
      status: 'queued',
      phase: 'queued',
      branch: repository.branch,
    })
    .returning({ id: scans.id })
  if (!scan) throw new Error('Failed to create scan')

  // Always advance the schedule, even for manual scans, so a manual scan
  // never causes a second scheduled scan immediately afterwards.
  await db
    .update(repositories)
    .set({
      nextScanAt: repository.enabled
        ? computeNextScanAt(repository.cronExpression, new Date())
        : null,
      updatedAt: new Date(),
    })
    .where(eq(repositories.id, repositoryId))

  void runScanPipeline(scan.id, repository).catch((error) => {
    console.error(`[tecdebt] scan ${scan.id} crashed`, error)
  })
  return scan.id
}

async function setPhase(scanId: number, phase: string) {
  await db.update(scans).set({ phase }).where(eq(scans.id, scanId))
}

/**
 * fresh clone → GitNexus refresh → knowledge refresh → Eve scanners →
 * structured findings → reconcile → score → fix prompts → persist.
 * The clone, GitNexus and agent steps run inside Eve; this function prepares
 * the request, waits for the durable session and persists the outcome.
 */
async function runScanPipeline(scanId: number, repository: Repository) {
  const env = getServerEnv()
  const startedAt = new Date()
  try {
    await db
      .update(scans)
      .set({ status: 'running', phase: 'preparing', startedAt })
      .where(eq(scans.id, scanId))

    const gitnexus = env.GITNEXUS_ENABLED ? await ensureGitNexusServer() : false

    const knowledge = await db.query.repositoryKnowledge.findFirst({
      where: eq(repositoryKnowledge.repositoryId, repository.id),
    })
    const openFindings = await db.query.findings.findMany({
      where: and(
        eq(findings.repositoryId, repository.id),
        inArray(findings.state, [...OPEN_FINDING_STATES]),
      ),
    })

    await db.insert(scannerRuns).values(
      enabledScanners.map((scanner) => ({
        scanId,
        scannerId: scanner.id,
        status: 'pending' as const,
      })),
    )

    await writeScanRequest({
      scanId,
      repositoryId: repository.id,
      repositoryName: repository.name,
      repositoryUrl: repository.url,
      branch: repository.branch,
      gitnexus,
      knowledge: knowledge
        ? {
            overview: knowledge.overview,
            summary: knowledge.summary,
            sources: knowledge.sources,
            fileCount: knowledge.fileCount,
          }
        : null,
      scanners: enabledScanners.map((scanner) => ({
        id: scanner.id,
        name: scanner.name,
        prompt: scanner.prompt,
        hypotheses: openFindings
          .filter((finding) => finding.scannerId === scanner.id)
          .map((finding) => ({
            findingId: finding.id,
            fingerprint: finding.fingerprint,
            title: finding.title,
            severity: finding.severity,
            description: finding.description,
            locations: finding.locations,
          })),
      })),
      outputSchema: scannerResultJsonSchema,
    })

    await setPhase(scanId, 'starting agent')
    await db
      .update(scannerRuns)
      .set({ status: 'running', startedAt: new Date() })
      .where(eq(scannerRuns.scanId, scanId))

    const outcome = await runEveScanSession(scanId, (phase) =>
      setPhase(scanId, phase),
    )
    await db
      .update(scans)
      .set({ eveSessionId: outcome.sessionId })
      .where(eq(scans.id, scanId))

    const result = await readScanResult(scanId)
    if (!result) {
      throw new Error(
        outcome.failure ??
          `Eve finished with status "${outcome.status}" but wrote no result file.`,
      )
    }

    await setPhase(scanId, 'reconciling')
    await persistScanResult(scanId, repository, result)
    await removeScanWorkspace(repository.id, scanId)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await db
      .update(scans)
      .set({
        status: 'failed',
        phase: 'failed',
        error: message,
        finishedAt: new Date(),
      })
      .where(eq(scans.id, scanId))
    await db
      .update(scannerRuns)
      .set({
        status: 'failed',
        error: 'Scan failed before this scanner produced a result.',
        finishedAt: new Date(),
      })
      .where(
        and(
          eq(scannerRuns.scanId, scanId),
          inArray(scannerRuns.status, ['pending', 'running']),
        ),
      )
    await removeScanWorkspace(repository.id, scanId).catch(() => undefined)
  }
}

async function persistScanResult(
  scanId: number,
  repository: Repository,
  result: Awaited<ReturnType<typeof readScanResult>> & object,
) {
  const finishedAt = new Date()
  const countsPerScanner: FindingCounts[] = []
  const scoreInputs: {
    scanner: { id: string; weight: number }
    score: number | null
  }[] = []
  let failedScanners = 0

  for (const outcome of result.scanners) {
    const scanner = getScanner(outcome.scannerId)
    if (!scanner) continue

    if (outcome.status !== 'completed' || !outcome.result) {
      failedScanners += 1
      await db
        .update(scannerRuns)
        .set({
          status: 'failed',
          error: outcome.error ?? 'Scanner failed.',
          startedAt: new Date(outcome.startedAt),
          finishedAt: new Date(outcome.finishedAt),
        })
        .where(
          and(
            eq(scannerRuns.scanId, scanId),
            eq(scannerRuns.scannerId, scanner.id),
          ),
        )
      scoreInputs.push({ scanner, score: null })
      continue
    }

    const scannerResult: ScannerResult = outcome.result
    const reconciled = await reconcileScannerFindings({
      repositoryId: repository.id,
      scanId,
      scannerId: scanner.id,
      result: scannerResult,
    })
    countsPerScanner.push(reconciled.counts)

    const openFindings = reconciled.findings.filter((entry) =>
      OPEN_FINDING_STATES.includes(entry.state),
    )
    const score = calculateScannerScore(
      openFindings.map((entry) => entry.finding),
    )
    scoreInputs.push({ scanner, score })

    const fixPrompt = buildFixPrompt({
      scanner,
      repositoryName: repository.name,
      repositoryUrl: repository.url,
      branch: repository.branch,
      commitSha: result.commitSha,
      findings: openFindings.map((entry) => entry.finding),
    })

    await db
      .update(scannerRuns)
      .set({
        status: 'completed',
        score,
        summary: scannerResult.summary,
        fixPrompt,
        startedAt: new Date(outcome.startedAt),
        finishedAt: new Date(outcome.finishedAt),
      })
      .where(
        and(
          eq(scannerRuns.scanId, scanId),
          eq(scannerRuns.scannerId, scanner.id),
        ),
      )
  }

  if (result.knowledge.overview.trim().length > 0) {
    await db
      .insert(repositoryKnowledge)
      .values({
        repositoryId: repository.id,
        overview: result.knowledge.overview,
        summary: result.knowledge.summary,
        sources: [...result.knowledge.sources],
        commitSha: result.commitSha,
        fileCount: result.fileCount,
        refreshedAt: result.knowledge.refreshed ? finishedAt : undefined,
      })
      .onConflictDoUpdate({
        target: repositoryKnowledge.repositoryId,
        set: {
          overview: result.knowledge.overview,
          summary: result.knowledge.summary,
          sources: [...result.knowledge.sources],
          commitSha: result.commitSha,
          fileCount: result.fileCount,
          updatedAt: finishedAt,
          ...(result.knowledge.refreshed ? { refreshedAt: finishedAt } : {}),
        },
      })
  }

  const overallScore = calculateOverallScore(scoreInputs)
  const counts = sumCounts(countsPerScanner)
  const allFailed = failedScanners === result.scanners.length

  await db
    .update(scans)
    .set({
      status: allFailed
        ? 'failed'
        : failedScanners > 0
          ? 'partial'
          : 'completed',
      phase: 'done',
      commitSha: result.commitSha,
      fileCount: result.fileCount,
      gitnexusUsed: result.gitnexusUsed,
      knowledgeRefreshed: result.knowledge.refreshed,
      overallScore,
      grade: gradeForScore(overallScore),
      counts,
      error: allFailed ? 'Every scanner failed.' : null,
      finishedAt,
    })
    .where(eq(scans.id, scanId))

  await db
    .update(repositories)
    .set({ lastScanAt: finishedAt, updatedAt: finishedAt })
    .where(eq(repositories.id, repository.id))
}

/**
 * Scans left in `queued`/`running` by a previous app process cannot be
 * resumed by this PoC (the Eve session may still finish, but nobody is
 * listening), so they are marked failed on startup. Only scans without
 * activity for a while are affected: the dev server re-evaluates this module
 * on reloads while a scan started seconds ago is still legitimately running.
 */
const ORPHAN_GRACE_MS = 30 * 60_000

export async function failOrphanedScans(): Promise<number> {
  const cutoff = new Date(Date.now() - ORPHAN_GRACE_MS)
  const orphaned = await db
    .update(scans)
    .set({
      status: 'failed',
      phase: 'failed',
      error: 'The application restarted while this scan was running.',
      finishedAt: new Date(),
    })
    .where(
      and(
        inArray(scans.status, [...ACTIVE_SCAN_STATUSES]),
        lt(scans.createdAt, cutoff),
      ),
    )
    .returning({ id: scans.id })
  if (orphaned.length > 0) {
    await db
      .update(scannerRuns)
      .set({
        status: 'failed',
        error: 'The application restarted.',
        finishedAt: new Date(),
      })
      .where(
        and(
          inArray(
            scannerRuns.scanId,
            orphaned.map((scan) => scan.id),
          ),
          inArray(scannerRuns.status, ['pending', 'running']),
        ),
      )
  }
  return orphaned.length
}
