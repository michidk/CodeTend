import { readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import postgres from 'postgres'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is required')

const client = postgres(connectionString, { max: 1 })
const rollback = new Error('rollback database smoke test')

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

  console.log(
    `Database smoke test passed (${migrationFiles.length} migrations, security schema present, active scan/patch constraints enforced)`,
  )
} finally {
  await client.end()
}
