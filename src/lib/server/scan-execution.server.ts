import '@tanstack/react-start/server-only'

import { and, desc, eq, inArray, isNotNull, isNull, or } from 'drizzle-orm'
import { db } from '@/db'
import {
  findings,
  type Repository,
  repositoryKnowledge,
  repositorySecurityProfiles,
  scannerRuns,
  scans,
} from '@/db/schema'
import { getServerEnv } from '@/lib/env.server'
import { OPEN_FINDING_STATES, scannerResultJsonSchema } from '@/lib/findings'
import {
  cancelAndDrainEveSession,
  cancelEveScanSession,
  startEveScanSession,
} from '@/lib/server/eve-client.server'
import { ensureGitNexusServer } from '@/lib/server/gitnexus.server'
import {
  readScanCheckpoint,
  readScanResult,
  waitForScanResult,
  writeScanRequest,
} from '@/lib/server/scan-files.server'
import {
  cancellationRequested,
  cancelScanRecord,
  cleanupScanFiles,
  failScan,
} from '@/lib/server/scan-recovery.server'
import {
  persistScanCheckpoint,
  persistScanResult,
} from '@/lib/server/scan-result-ingestion.server'
import {
  ACTIVE_SCAN_STATUSES,
  SCAN_TIMEOUT_MS,
  setScanProgress,
  throwIfCancellationRequested,
} from '@/lib/server/scan-runtime.server'
import { listGlobalScanners } from '@/lib/server/scanner-settings'

/**
 * fresh clone → GitNexus refresh → knowledge refresh → Eve scanners →
 * structured findings → reconcile → score → fix prompts → persist.
 * The clone, GitNexus and agent steps run inside Eve; this function prepares
 * the request, waits for the durable session and persists the outcome.
 */
export async function runScanPipeline(scanId: number, repository: Repository) {
  try {
    const preparation = await prepareScanExecution(scanId, repository)
    if (!preparation) return
    await superviseScanExecution(scanId, repository, preparation)
  } catch (error) {
    if (await cancellationRequested(scanId)) {
      await cancelScanRecord(scanId, repository.id)
    } else {
      await failScan(
        scanId,
        repository.id,
        error instanceof Error ? error.message : String(error),
      )
    }
  }
}

async function superviseScanExecution(
  scanId: number,
  repository: Repository,
  preparation: NonNullable<Awaited<ReturnType<typeof prepareScanExecution>>>,
) {
  const { scanConfiguration, activeAgentScannerCount } = preparation
  await setScanProgress(scanId, {
    phase: 'starting agent',
    detail: `${activeAgentScannerCount} scanners configured`,
    completed: 0,
    total: 1,
    scannerCompleted: 0,
    scannerTotal: activeAgentScannerCount,
  })
  if (await cancellationRequested(scanId)) {
    await cancelScanRecord(scanId, repository.id)
    return
  }
  await db
    .update(scannerRuns)
    .set({ status: 'running', startedAt: new Date() })
    .where(eq(scannerRuns.scanId, scanId))

  const session = await startEveScanSession(scanId, {
    model: scanConfiguration.requestedModel,
    effort: scanConfiguration.requestedEffort,
  })
  const attached = await db
    .update(scans)
    .set({ eveSessionId: session.sessionId })
    .where(
      and(
        eq(scans.id, scanId),
        inArray(scans.status, [...ACTIVE_SCAN_STATUSES]),
        isNull(scans.cancellationRequestedAt),
      ),
    )
    .returning({ id: scans.id })
  if (attached.length === 0) {
    await cancelEveScanSession(session.sessionId).catch(() => undefined)
    await cancelScanRecord(scanId, repository.id)
    return
  }

  const ingestCheckpoint = async () => {
    const checkpoint = await readScanCheckpoint(scanId)
    if (checkpoint) {
      await persistScanCheckpoint(scanId, repository, checkpoint)
    }
  }
  const settlement = session
    .settle(async (progress) => {
      await setScanProgress(scanId, progress)
      await ingestCheckpoint()
    })
    .catch((error) => {
      console.warn(
        `[CodeTend] scan ${scanId}: Eve stream ended early, waiting for the result file`,
        error,
      )
      return waitForScanResult(scanId, SCAN_TIMEOUT_MS).then(() => null)
    })
  const completion = await Promise.race([
    settlement.then((outcome) => ({ kind: 'settled' as const, outcome })),
    waitForResultWithCheckpoints(
      scanId,
      SCAN_TIMEOUT_MS,
      ingestCheckpoint,
    ).then(
      () => ({ kind: 'result' as const }),
      (error: unknown) => ({ kind: 'deadline' as const, error }),
    ),
  ])
  if (completion.kind === 'deadline') {
    await setScanProgress(scanId, {
      phase: 'cancelling',
      detail: 'Scan deadline reached; draining Eve session',
      completed: 1,
      total: 1,
    })
    await cancelAndDrainEveSession(session.sessionId, settlement)
    throw completion.error
  }
  const outcome = completion.kind === 'settled' ? completion.outcome : null

  const result = await readScanResult(scanId)
  if (await cancellationRequested(scanId)) {
    await cancelScanRecord(scanId, repository.id)
    return
  }
  if (!result) {
    throw new Error(
      outcome?.failure ??
        `Eve finished with status "${outcome?.status ?? 'unknown'}" but wrote no result file.`,
    )
  }

  await throwIfCancellationRequested(scanId)
  await setScanProgress(scanId, {
    phase: 'reconciling',
    detail: 'Saving findings and scores',
    completed: 1,
    total: 1,
  })
  await persistScanResult(scanId, repository, result)
  await cleanupScanFiles(repository.id, scanId)
}

async function prepareScanExecution(scanId: number, repository: Repository) {
  const env = getServerEnv()
  await throwIfCancellationRequested(scanId)
  const scanConfiguration = await db.query.scans.findFirst({
    where: eq(scans.id, scanId),
    columns: {
      target: true,
      maxInputTokens: true,
      maxCostUsd: true,
      requestedModel: true,
      requestedEffort: true,
    },
  })
  if (!scanConfiguration) throw new Error('Scan configuration disappeared')
  if (await cancellationRequested(scanId)) {
    await cancelScanRecord(scanId, repository.id)
    return null
  }
  const claimed = await db.query.scans.findFirst({
    where: and(
      eq(scans.id, scanId),
      eq(scans.status, 'running'),
      isNull(scans.cancellationRequestedAt),
    ),
    columns: { id: true },
  })
  if (!claimed) {
    await cancelScanRecord(scanId, repository.id)
    return null
  }

  const activeScanners = (await listGlobalScanners()).filter(
    (scanner) => scanner.enabled,
  )
  if (activeScanners.length === 0) {
    throw new Error('No scanners are enabled. Enable a scanner and try again.')
  }
  const activeAgentScanners = activeScanners.filter(
    (scanner) => scanner.kind !== 'dependency-audit',
  )
  const gitnexus = env.GITNEXUS_ENABLED ? await ensureGitNexusServer() : false
  await throwIfCancellationRequested(scanId)

  const [knowledge, securityProfile, openFindings, recentAttention] =
    await Promise.all([
      db.query.repositoryKnowledge.findFirst({
        where: eq(repositoryKnowledge.repositoryId, repository.id),
      }),
      db.query.repositorySecurityProfiles.findFirst({
        where: eq(repositorySecurityProfiles.repositoryId, repository.id),
      }),
      db.query.findings.findMany({
        where: and(
          eq(findings.repositoryId, repository.id),
          or(
            inArray(findings.state, [...OPEN_FINDING_STATES]),
            isNotNull(findings.disposition),
          ),
        ),
      }),
      db
        .select({
          scannerId: scannerRuns.scannerId,
          investigation: scannerRuns.investigation,
        })
        .from(scannerRuns)
        .innerJoin(scans, eq(scannerRuns.scanId, scans.id))
        .where(
          and(
            eq(scans.repositoryId, repository.id),
            isNotNull(scannerRuns.investigation),
          ),
        )
        .orderBy(desc(scans.createdAt))
        .limit(Math.max(5, activeAgentScanners.length * 5)),
    ])

  await db.insert(scannerRuns).values(
    activeScanners.map((scanner) => ({
      scanId,
      scannerId: scanner.id,
      scannerDefinition: scanner,
      status: 'pending' as const,
      requestedModel: scanner.model ?? scanConfiguration.requestedModel,
      requestedEffort: scanner.effort ?? scanConfiguration.requestedEffort,
    })),
  )
  const previousScan = await db.query.scans.findFirst({
    where: and(
      eq(scans.repositoryId, repository.id),
      inArray(scans.status, ['completed', 'partial']),
    ),
    orderBy: (table, { desc }) => [desc(table.createdAt)],
    columns: { commitSha: true },
  })
  await writeScanRequest({
    contractVersion: 1,
    executionProfile: {
      model: scanConfiguration.requestedModel,
      effort: scanConfiguration.requestedEffort,
    },
    scanId,
    previousCommitSha: previousScan?.commitSha ?? null,
    target: scanConfiguration.target,
    maxInputTokens: scanConfiguration.maxInputTokens,
    maxCostUsd: scanConfiguration.maxCostUsd,
    securityProfile: securityProfile?.profile ?? null,
    validation: {
      enabled: env.TECDEBT_VALIDATION_ENABLED,
      runner: env.TECDEBT_VALIDATION_RUNNER,
      image: env.TECDEBT_VALIDATION_IMAGE,
    },
    dependencyAudit: activeScanners.some(
      (scanner) => scanner.kind === 'dependency-audit',
    ),
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
    scanners: activeAgentScanners.map((scanner) => ({
      id: scanner.id,
      name: scanner.name,
      prompt: scanner.prompt,
      executionProfile: {
        model: scanner.model ?? scanConfiguration.requestedModel,
        effort: scanner.effort ?? scanConfiguration.requestedEffort,
      },
      attentionHistory: recentAttention
        .filter((entry) => entry.scannerId === scanner.id)
        .flatMap((entry) => (entry.investigation ? [entry.investigation] : []))
        .slice(0, 5),
      hypotheses: openFindings
        .filter((finding) => finding.scannerId === scanner.id)
        .map((finding) => ({
          findingId: finding.id,
          fingerprint: finding.fingerprint,
          title: finding.title,
          severity: finding.severity,
          description: finding.description,
          subject: finding.subject,
          evidence: finding.evidence,
          locations: finding.locations,
          classification: finding.classification,
          securityContext: finding.securityContext,
          disposition: finding.disposition,
          dispositionNote: finding.dispositionNote,
        })),
    })),
    outputSchema: scannerResultJsonSchema,
  })
  return {
    scanConfiguration,
    activeAgentScannerCount: activeAgentScanners.length,
  }
}

export async function waitForResultWithCheckpoints(
  scanId: number,
  timeoutMs: number,
  ingest: () => Promise<void>,
): Promise<null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if ((await readScanResult(scanId)) !== null) return null
    await ingest()
    await new Promise((resolve) => setTimeout(resolve, 3_000))
  }
  await waitForScanResult(scanId, 1)
  return null
}
