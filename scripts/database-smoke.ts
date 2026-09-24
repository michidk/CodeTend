import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { db, setDatabaseForTesting } from '@/db'
import * as schema from '@/db/schema'
import type { ScanCheckpoint, ScanResult } from '@/lib/eve-protocol'
import type { EnrichedScannerFinding } from '@/lib/findings'
import {
  decideFindingPatchImpl,
  generateFindingPatchImpl,
  persistPatchResult,
  recoverInterruptedPatches,
} from '@/lib/server/finding-patches.server'
import { reconcileScannerFindings } from '@/lib/server/finding-reconciliation.server'
import {
  updateFindingAsFixed,
  updateFindingDisposition,
} from '@/lib/server/finding-triage'
import { startScan } from '@/lib/server/scan-admission.server'
import {
  recoverInterruptedScans,
  requestScanCancellation,
} from '@/lib/server/scan-recovery.server'
import {
  persistScanCheckpoint,
  persistScanResult,
} from '@/lib/server/scan-result-ingestion.server'
import { runSchedulerTick } from '@/lib/server/scheduler.server'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is required')

const client = postgres(connectionString, { max: 1 })
const rollback = new Error('rollback database smoke test')
const lifecycleDataDir = await mkdtemp(join(tmpdir(), 'codetend-lifecycle-'))
process.env.TECDEBT_DATA_DIR = lifecycleDataDir
process.env.GITNEXUS_ENABLED = 'false'
setDatabaseForTesting(drizzle(client, { schema }))

try {
  const migrationFiles = (await readdir(resolve('drizzle'))).filter((file) =>
    /^\d+_.+\.sql$/.test(file),
  )
  const [migrationState] = await client<[{ applied: number }]>`
    select count(*)::int as applied from drizzle.__drizzle_migrations
  `
  if (migrationState.applied !== migrationFiles.length) {
    throw new Error(
      `Expected ${migrationFiles.length} migrations, found ${migrationState.applied}`,
    )
  }

  const requiredRepositoryScheduleColumns = [
    'schedule_enabled',
    'schedule_cron_expression',
    'next_scheduled_scan_at',
  ]
  const repositoryColumns = await client<{ column_name: string }[]>`
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'repositories'
      and column_name = any(${requiredRepositoryScheduleColumns})
  `
  const presentRepositoryColumns = new Set(
    repositoryColumns.map((column) => column.column_name),
  )
  const missingRepositoryColumns = requiredRepositoryScheduleColumns.filter(
    (column) => !presentRepositoryColumns.has(column),
  )
  if (missingRepositoryColumns.length > 0) {
    throw new Error(
      `Missing repository schedule columns: ${missingRepositoryColumns.join(', ')}`,
    )
  }

  const requiredScheduleColumns = [
    'mode',
    'scans_per_day',
    'last_distributed_repository_id',
  ]
  const scheduleColumns = await client<{ column_name: string }[]>`
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'scan_schedule_settings'
      and column_name = any(${requiredScheduleColumns})
  `
  const presentScheduleColumns = new Set(
    scheduleColumns.map((column) => column.column_name),
  )
  const missingScheduleColumns = requiredScheduleColumns.filter(
    (column) => !presentScheduleColumns.has(column),
  )
  if (missingScheduleColumns.length > 0) {
    throw new Error(
      `Missing scan schedule columns: ${missingScheduleColumns.join(', ')}`,
    )
  }

  const requiredFindingColumns = [
    'classification',
    'security_context',
    'root_cause',
    'code_evidence',
    'attack_path',
    'validation_plan',
    'remediation_tests',
    'preventive_controls',
    'vulnerability',
    'priority',
    'disposition',
    'disposition_note',
    'triaged_at',
  ]
  const columns = await client<{ column_name: string }[]>`
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'findings'
      and column_name = any(${requiredFindingColumns})
  `
  const present = new Set(columns.map((column) => column.column_name))
  const missing = requiredFindingColumns.filter(
    (column) => !present.has(column),
  )
  if (missing.length > 0) {
    throw new Error(`Missing finding columns: ${missing.join(', ')}`)
  }

  const requiredScanColumns = [
    'mode',
    'target',
    'max_cost_usd',
    'cancellation_requested_at',
    'coverage',
    'manifest',
  ]
  const scanColumns = await client<{ column_name: string }[]>`
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'scans'
      and column_name = any(${requiredScanColumns})
  `
  const presentScanColumns = new Set(
    scanColumns.map((column) => column.column_name),
  )
  const missingScanColumns = requiredScanColumns.filter(
    (column) => !presentScanColumns.has(column),
  )
  if (missingScanColumns.length > 0) {
    throw new Error(`Missing scan columns: ${missingScanColumns.join(', ')}`)
  }

  const requiredTables = [
    'finding_events',
    'finding_patches',
    'finding_validations',
    'global_scanner_settings',
    'repository_security_profiles',
    'scan_artifacts',
    'scan_schedule_settings',
    'scheduled_repository_queue',
  ]
  const tables = await client<{ table_name: string }[]>`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_name = any(${requiredTables})
  `
  const presentTables = new Set(tables.map((table) => table.table_name))
  const missingTables = requiredTables.filter(
    (table) => !presentTables.has(table),
  )
  if (missingTables.length > 0) {
    throw new Error(`Missing security tables: ${missingTables.join(', ')}`)
  }

  const scannerRunColumns = await client<{ column_name: string }[]>`
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'scanner_runs'
      and column_name = 'scanner_definition'
  `
  if (scannerRunColumns.length !== 1) {
    throw new Error('Missing scanner run definition snapshot column')
  }

  const requiredPatchColumns = [
    'eve_session_id',
    'model',
    'input_tokens',
    'output_tokens',
    'cache_read_tokens',
    'cache_write_tokens',
    'estimated_cost_usd',
    'model_calls',
  ]
  const patchColumns = await client<{ column_name: string }[]>`
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'finding_patches'
      and column_name = any(${requiredPatchColumns})
  `
  const presentPatchColumns = new Set(
    patchColumns.map((column) => column.column_name),
  )
  const missingPatchColumns = requiredPatchColumns.filter(
    (column) => !presentPatchColumns.has(column),
  )
  if (missingPatchColumns.length > 0) {
    throw new Error(`Missing patch columns: ${missingPatchColumns.join(', ')}`)
  }

  let activeConstraintEnforced = false
  try {
    await client.begin(async (transaction) => {
      const [repository] = await transaction<[{ id: number }]>`
        insert into repositories (name, url, branch)
        values ('database smoke test', 'https://github.com/example/test.git', 'main')
        returning id
      `
      await transaction`
        insert into scans (repository_id, status, trigger)
        values (${repository.id}, 'queued', 'manual')
      `
      const [scanDefaults] = await transaction<
        [{ mode: string; target: { kind?: string } }]
      >`
        select mode, target from scans
        where repository_id = ${repository.id}
      `
      if (
        scanDefaults.mode !== 'standard' ||
        scanDefaults.target.kind !== 'repository'
      ) {
        throw new Error('Scan mode or target defaults are invalid')
      }
      try {
        await transaction`
          insert into scans (repository_id, status, trigger)
          values (${repository.id}, 'running', 'manual')
        `
      } catch (error) {
        activeConstraintEnforced =
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === '23505'
      }
      throw rollback
    })
  } catch (error) {
    if (error !== rollback) throw error
  }
  if (!activeConstraintEnforced) {
    throw new Error('Active-scan uniqueness constraint was not enforced')
  }

  let activePatchConstraintEnforced = false
  try {
    await client.begin(async (transaction) => {
      const [repository] = await transaction<[{ id: number }]>`
        insert into repositories (name, url, branch)
        values ('patch smoke test', 'https://github.com/example/patch.git', 'main')
        returning id
      `
      const [finding] = await transaction<[{ id: number }]>`
        insert into findings (
          repository_id, scanner_id, fingerprint, title, severity, confidence,
          description, why_it_matters, recommendation, effort
        ) values (
          ${repository.id}, 'security', 'patch-smoke', 'Patch smoke finding',
          'high', 'high', 'Description', 'Impact', 'Recommendation', 'small'
        )
        returning id
      `
      await transaction`
        insert into finding_patches (finding_id, status, diff, summary)
        values (${finding.id}, 'generating', '', 'Generating')
      `
      try {
        await transaction`
          insert into finding_patches (finding_id, status, diff, summary)
          values (${finding.id}, 'proposed', 'diff', 'Proposed')
        `
      } catch (error) {
        activePatchConstraintEnforced =
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === '23505'
      }
      throw rollback
    })
  } catch (error) {
    if (error !== rollback) throw error
  }
  if (!activePatchConstraintEnforced) {
    throw new Error('Active-patch uniqueness constraint was not enforced')
  }

  let lifecycleStateVerified = false
  try {
    await client.begin(async (transaction) => {
      const [repository] = await transaction<[{ id: number }]>`
        insert into repositories (name, url, branch)
        values ('lifecycle smoke test', 'https://github.com/example/lifecycle.git', 'main')
        returning id
      `
      const [scan] = await transaction<[{ id: number }]>`
        insert into scans (repository_id, status, trigger, phase, started_at)
        values (${repository.id}, 'running', 'manual', 'scanning', now())
        returning id
      `
      await transaction`
        insert into scanner_runs (scan_id, scanner_id, status, started_at)
        values (${scan.id}, 'reliability', 'running', now())
      `
      const [finding] = await transaction<[{ id: number }]>`
        insert into findings (
          repository_id, scanner_id, fingerprint, state, title, severity,
          confidence, description, why_it_matters, recommendation, effort,
          first_seen_scan_id, last_seen_scan_id
        ) values (
          ${repository.id}, 'reliability', 'retry-safe-event', 'new',
          'Retry-safe event', 'high', 'high', 'Description', 'Impact',
          'Recommendation', 'small', ${scan.id}, ${scan.id}
        )
        returning id
      `

      for (let attempt = 0; attempt < 2; attempt += 1) {
        await transaction`
          insert into finding_events (
            finding_id, scan_id, kind, actor, from_state, to_state
          ) values (
            ${finding.id}, ${scan.id}, 'detected', 'scanner', null, 'new'
          )
          on conflict do nothing
        `
      }
      const [eventCount] = await transaction<[{ count: number }]>`
        select count(*)::int as count
        from finding_events
        where finding_id = ${finding.id}
          and scan_id = ${scan.id}
          and kind = 'detected'
      `
      if (eventCount.count !== 1) {
        throw new Error('Retried finding event was not idempotent')
      }

      await transaction`
        update scans
        set cancellation_requested_at = now(), phase = 'cancelling'
        where id = ${scan.id} and status in ('queued', 'running')
      `
      await transaction`
        update scans
        set status = 'cancelled', phase = 'cancelled', progress = null,
            error = null, finished_at = now()
        where id = ${scan.id} and status in ('queued', 'running')
      `
      await transaction`
        update scanner_runs
        set status = 'cancelled', error = null, finished_at = now()
        where scan_id = ${scan.id} and status in ('pending', 'running')
      `
      const [terminalState] = await transaction<
        [{ scan_status: string; run_status: string }]
      >`
        select scans.status as scan_status, scanner_runs.status as run_status
        from scans
        join scanner_runs on scanner_runs.scan_id = scans.id
        where scans.id = ${scan.id}
      `
      lifecycleStateVerified =
        terminalState.scan_status === 'cancelled' &&
        terminalState.run_status === 'cancelled'
      throw rollback
    })
  } catch (error) {
    if (error !== rollback) throw error
  }
  if (!lifecycleStateVerified) {
    throw new Error('Cancellation did not terminate the scan and scanner run')
  }

  const lifecycleRepositoryName = `lifecycle-services-${Date.now()}`
  const [lifecycleRepository] = await client<[{ id: number }]>`
    insert into repositories (name, url, branch)
    values (
      ${lifecycleRepositoryName},
      'https://github.com/example/lifecycle-services.git',
      'main'
    )
    returning id
  `
  try {
    const [sourceScan] = await client<[{ id: number }]>`
      insert into scans (
        repository_id, status, trigger, phase, commit_sha, branch, finished_at
      ) values (
        ${lifecycleRepository.id}, 'completed', 'manual', 'done',
        '0123456789abcdef0123456789abcdef01234567', 'main', now()
      )
      returning id
    `
    await client`
      insert into scanner_runs (scan_id, scanner_id, status, started_at, finished_at)
      values (${sourceScan.id}, 'reliability', 'completed', now(), now())
    `
    const finding: EnrichedScannerFinding = {
      fingerprint: 'service-lifecycle-finding',
      title: 'Service lifecycle finding',
      severity: 'high',
      confidence: 'high',
      description: 'A finding used to exercise persisted lifecycle services.',
      whyItMatters: 'State, occurrence, and event writes must agree.',
      recommendation: 'Persist the transition atomically.',
      effort: 'small',
      subject: { kind: 'file', path: 'src/example.ts' },
      evidence: [
        {
          kind: 'file',
          path: 'src/example.ts',
          startLine: 1,
          summary: 'Representative lifecycle evidence.',
        },
      ],
      locations: [{ path: 'src/example.ts', startLine: 1 }],
      priorityReasons: [],
    }
    const scannerResult = (fresh: readonly EnrichedScannerFinding[]) => ({
      summary: 'Lifecycle smoke result.',
      findings: [...fresh],
      hypothesisVerdicts: [],
      investigation: {
        strategy: 'Exercise the persisted lifecycle.',
        focusAreas: [],
        evidence: [],
        blindSpots: [],
        confidence: 'high' as const,
      },
      coverage: {
        completeness: 'complete' as const,
        reviewed: [],
        deferred: [],
        excluded: [],
        openQuestions: [],
      },
    })

    const reconciliation = await reconcileScannerFindings({
      repositoryId: lifecycleRepository.id,
      scanId: sourceScan.id,
      scannerId: 'reliability',
      result: scannerResult([finding]),
      target: { kind: 'repository' },
    })
    const reconciledFinding = reconciliation.findings[0]
    if (!reconciledFinding || reconciliation.counts.new !== 1) {
      throw new Error('Finding reconciliation did not create the finding')
    }
    const [reconciliationRows] = await client<
      [{ occurrences: number; events: number }]
    >`
      select
        (select count(*)::int from finding_occurrences
          where finding_id = ${reconciledFinding.id}) as occurrences,
        (select count(*)::int from finding_events
          where finding_id = ${reconciledFinding.id}) as events
    `
    if (
      reconciliationRows.occurrences !== 1 ||
      reconciliationRows.events !== 1
    ) {
      throw new Error('Reconciliation omitted its occurrence or history event')
    }

    const repeatedReconciliation = await reconcileScannerFindings({
      repositoryId: lifecycleRepository.id,
      scanId: sourceScan.id,
      scannerId: 'reliability',
      result: scannerResult([finding]),
      target: { kind: 'repository' },
    })
    const [afterRepeatedReconciliation] = await client<
      [{ state: string; occurrences: number; events: number }]
    >`
      select
        findings.state,
        (select count(*)::int from finding_occurrences
          where finding_id = findings.id) as occurrences,
        (select count(*)::int from finding_events
          where finding_id = findings.id) as events
      from findings
      where findings.id = ${reconciledFinding.id}
    `
    if (
      repeatedReconciliation.counts.new !== 1 ||
      repeatedReconciliation.findings[0]?.state !== 'new' ||
      afterRepeatedReconciliation.state !== 'new' ||
      afterRepeatedReconciliation.occurrences !== 1 ||
      afterRepeatedReconciliation.events !== 1
    ) {
      throw new Error(
        'Repeated reconciliation changed persisted lifecycle state',
      )
    }

    const repositoryRecord = await db.query.repositories.findFirst({
      where: (table, { eq }) => eq(table.id, lifecycleRepository.id),
    })
    if (!repositoryRecord) throw new Error('Lifecycle repository disappeared')
    const [ingestionScan] = await client<[{ id: number }]>`
      insert into scans (
        repository_id, status, trigger, phase, branch, target, started_at
      ) values (
        ${lifecycleRepository.id}, 'running', 'manual', 'scanning', 'main',
        '{"kind":"repository"}'::jsonb, now()
      )
      returning id
    `
    await client`
      insert into scanner_runs (scan_id, scanner_id, status, started_at)
      values (${ingestionScan.id}, 'reliability', 'running', now())
    `
    const ingestionFinding = {
      ...finding,
      fingerprint: 'checkpoint-result-idempotency',
      title: 'Checkpoint result idempotency',
    }
    const ingestionOutcome = {
      scannerId: 'reliability',
      status: 'completed' as const,
      result: scannerResult([ingestionFinding]),
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    }
    const commitSha = 'abcdef0123456789abcdef0123456789abcdef01'
    const knowledge = {
      refreshed: false,
      overview: '',
      summary: {
        languages: [],
        frameworks: [],
        subsystems: [],
        concepts: [],
      },
      sources: [],
      reason: 'Lifecycle smoke fixture.',
      dependencyGraph: {
        edges: [],
        cycles: [],
        cycleStatus: 'unavailable' as const,
        componentCount: null,
      },
    }
    const securityProfile = {
      projectOverview: '',
      assets: [],
      entryPoints: [],
      trustBoundaries: [],
      authAssumptions: [],
      sensitiveDataPaths: [],
      privilegedActions: [],
      securityInvariants: [],
      priorities: [],
      exclusions: [],
    }
    const checkpoint: ScanCheckpoint = {
      version: 1,
      requestFingerprint: 'lifecycle-smoke-request',
      scanId: ingestionScan.id,
      commitSha,
      fileCount: 1,
      gitnexusUsed: false,
      knowledge,
      securityProfile: { profile: securityProfile, generated: false },
      dependencyAudit: {
        status: 'unavailable',
        error: 'Disabled for lifecycle smoke test.',
        exploitabilityAssessments: [],
      },
      scanners: [ingestionOutcome],
      updatedAt: new Date().toISOString(),
    }
    await persistScanCheckpoint(ingestionScan.id, repositoryRecord, checkpoint)
    const finalResult: ScanResult = {
      ...checkpoint,
      investigation: scannerResult([]).investigation,
      coverage: scannerResult([]).coverage,
      validations: [],
      finishedAt: new Date().toISOString(),
    }
    await persistScanResult(ingestionScan.id, repositoryRecord, finalResult)
    const [ingestionState] = await client<
      [{ id: number; state: string; occurrences: number; events: number }]
    >`
      select
        findings.id,
        findings.state,
        (select count(*)::int from finding_occurrences
          where finding_id = findings.id) as occurrences,
        (select count(*)::int from finding_events
          where finding_id = findings.id) as events
      from findings
      where repository_id = ${lifecycleRepository.id}
        and scanner_id = 'reliability'
        and fingerprint = ${ingestionFinding.fingerprint}
    `
    if (
      ingestionState.state !== 'new' ||
      ingestionState.occurrences !== 1 ||
      ingestionState.events !== 1
    ) {
      throw new Error('Checkpoint and final ingestion were not idempotent')
    }

    await client`
      update scan_schedule_settings
      set scan_concurrency = 0, fix_concurrency = 0
      where id = 1
    `
    const admittedScanId = await startScan(lifecycleRepository.id, 'schedule')
    if (!admittedScanId) throw new Error('Scheduled scan was not admitted')
    const duplicateScanId = await startScan(lifecycleRepository.id, 'schedule')
    if (duplicateScanId !== null) {
      throw new Error('Duplicate active scan was admitted')
    }
    await requestScanCancellation(admittedScanId)
    const [cancelledAdmission] = await client<[{ status: string }]>`
      select status from scans where id = ${admittedScanId}
    `
    if (cancelledAdmission.status !== 'cancelled') {
      throw new Error('Queued scan cancellation did not finalize')
    }

    const admittedPatch = await generateFindingPatchImpl(ingestionState.id)
    const [queuedPatch] = await client<[{ status: string }]>`
      select status from finding_patches where id = ${admittedPatch.patchId}
    `
    if (queuedPatch.status !== 'queued') {
      throw new Error('Finding patch was not durably queued')
    }
    let duplicatePatchRejected = false
    try {
      await generateFindingPatchImpl(ingestionState.id)
    } catch {
      duplicatePatchRejected = true
    }
    if (!duplicatePatchRejected) {
      throw new Error('Duplicate active finding patch was admitted')
    }
    await client`
      update finding_patches set status = 'rejected'
      where id = ${admittedPatch.patchId}
    `

    let atomicFailureObserved = false
    try {
      await reconcileScannerFindings({
        repositoryId: lifecycleRepository.id,
        scanId: 2_000_000_000,
        scannerId: 'reliability',
        result: scannerResult([{ ...finding, severity: 'low' }]),
        target: { kind: 'repository' },
      })
    } catch {
      atomicFailureObserved = true
    }
    const [afterFailedReconciliation] = await client<[{ severity: string }]>`
      select severity from findings where id = ${reconciledFinding.id}
    `
    if (
      !atomicFailureObserved ||
      afterFailedReconciliation.severity !== 'high'
    ) {
      throw new Error('Failed reconciliation was not rolled back atomically')
    }

    const [patch] = await client<[{ id: number }]>`
      insert into finding_patches (
        finding_id, source_scan_id, status, diff, summary
      ) values (
        ${reconciledFinding.id}, ${sourceScan.id}, 'generating', '', 'Generating'
      )
      returning id
    `
    const proposedResult = {
      patchId: patch.id,
      status: 'proposed' as const,
      summary: 'Generated a reviewable patch.',
      diff: 'diff --git a/src/example.ts b/src/example.ts\n--- a/src/example.ts\n+++ b/src/example.ts\n@@ -1 +1 @@\n-old\n+new\n',
      changedFiles: ['src/example.ts'],
      testRecommendations: ['Run the focused lifecycle test.'],
      verification: null,
      finishedAt: new Date().toISOString(),
    }
    await persistPatchResult(patch.id, proposedResult)
    const accepted = await decideFindingPatchImpl({
      patchId: patch.id,
      decision: 'accepted',
    })
    if (accepted.status !== 'accepted') {
      throw new Error('Reviewable patch was not accepted')
    }

    const [recoveringPatch] = await client<[{ id: number }]>`
      insert into finding_patches (
        finding_id, source_scan_id, status, diff, summary, eve_session_id
      ) values (
        ${reconciledFinding.id}, ${sourceScan.id}, 'generating', '',
        'Recovering', 'lifecycle-smoke-session'
      )
      returning id
    `
    await mkdir(join(lifecycleDataDir, 'results'), { recursive: true })
    await writeFile(
      join(lifecycleDataDir, 'results', `patch-${recoveringPatch.id}.json`),
      JSON.stringify({
        ...proposedResult,
        patchId: recoveringPatch.id,
        status: 'verified',
      }),
    )
    await recoverInterruptedPatches({ waitForCompletion: true })
    const [recoveredPatch] = await client<[{ status: string }]>`
      select status from finding_patches where id = ${recoveringPatch.id}
    `
    if (recoveredPatch.status !== 'verified') {
      throw new Error('Interrupted patch result was not recovered')
    }
    await decideFindingPatchImpl({
      patchId: recoveringPatch.id,
      decision: 'rejected',
    })

    await updateFindingDisposition({
      findingId: reconciledFinding.id,
      disposition: 'accepted_risk',
      note: 'Accepted only for this lifecycle smoke fixture.',
    })
    await updateFindingDisposition({
      findingId: reconciledFinding.id,
      disposition: null,
      note: '',
    })
    await updateFindingAsFixed({
      findingId: reconciledFinding.id,
      note: 'Fixed by the lifecycle smoke fixture.',
    })
    const [operatorTransitions] = await client<
      [{ state: string; events: number }]
    >`
      select
        findings.state,
        (select count(*)::int from finding_events
          where finding_id = findings.id and actor = 'operator') as events
      from findings
      where findings.id = ${reconciledFinding.id}
    `
    if (
      operatorTransitions.state !== 'resolved' ||
      operatorTransitions.events !== 3
    ) {
      throw new Error(
        'Operator transitions did not persist atomic audit events',
      )
    }

    const [cancelledScan] = await client<[{ id: number }]>`
      insert into scans (
        repository_id, status, trigger, phase, branch,
        cancellation_requested_at, started_at
      ) values (
        ${lifecycleRepository.id}, 'running', 'manual', 'cancelling', 'main',
        now(), now()
      )
      returning id
    `
    await client`
      insert into scanner_runs (scan_id, scanner_id, status, started_at)
      values (${cancelledScan.id}, 'reliability', 'running', now())
    `
    await recoverInterruptedScans({ waitForCompletion: true })
    const [recoveredCancellation] = await client<
      [{ scan_status: string; run_status: string }]
    >`
      select scans.status as scan_status, scanner_runs.status as run_status
      from scans
      join scanner_runs on scanner_runs.scan_id = scans.id
      where scans.id = ${cancelledScan.id}
    `
    if (
      recoveredCancellation.scan_status !== 'cancelled' ||
      recoveredCancellation.run_status !== 'cancelled'
    ) {
      throw new Error('Restart recovery did not finalize cancellation')
    }

    await client`
      insert into scan_schedule_settings (
        id, enabled, mode, cron_expression, next_run_at,
        last_dispatched_at, cooldown_minutes
      ) values (
        1, true, 'cron', '0 2 * * *', now() - interval '1 minute',
        now(), 60
      )
      on conflict (id) do update set
        enabled = excluded.enabled,
        mode = excluded.mode,
        cron_expression = excluded.cron_expression,
        next_run_at = excluded.next_run_at,
        last_dispatched_at = excluded.last_dispatched_at,
        cooldown_minutes = excluded.cooldown_minutes
    `
    await runSchedulerTick()
    const [scheduled] = await client<[{ queued: number }]>`
      select count(*)::int as queued
      from scheduled_repository_queue
      where repository_id = ${lifecycleRepository.id}
    `
    if (scheduled.queued !== 1) {
      throw new Error('Scheduler tick did not durably enqueue the repository')
    }
  } finally {
    await client`
      delete from repositories where id = ${lifecycleRepository.id}
    `
    await client`
      update scan_schedule_settings
      set enabled = false, next_run_at = null, last_dispatched_at = null
      where id = 1
    `
  }

  console.log(
    `Database smoke test passed (${migrationFiles.length} migrations, security schema present, active constraints, lifecycle services, recovery, and scheduling verified)`,
  )
} finally {
  setDatabaseForTesting(undefined)
  await rm(lifecycleDataDir, { recursive: true, force: true })
  await client.end()
}
