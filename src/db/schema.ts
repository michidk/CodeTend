import { relations, sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import type {
  AttackPath,
  CodeEvidence,
  Confidence,
  Effort,
  FindingClassification,
  FindingDisposition,
  FindingLocation,
  FindingPriority,
  FindingState,
  SecurityContext,
  Severity,
  ValidationCommandResult,
  ValidationPlan,
  ValidationStatus,
  VulnerabilityMetadata,
} from '@/lib/findings'
import type {
  ScanCoverage,
  ScanManifest,
  ScanMode,
  ScanTarget,
  SecurityProfile,
} from '@/lib/security-scans'

const createdAt = timestamp('created_at', { withTimezone: true })
  .notNull()
  .defaultNow()
const updatedAt = timestamp('updated_at', { withTimezone: true })
  .notNull()
  .defaultNow()

export const SCAN_STATUSES = [
  'queued',
  'running',
  'completed',
  'partial',
  'failed',
  'cancelled',
] as const
export type ScanStatus = (typeof SCAN_STATUSES)[number]

export const SCAN_TRIGGERS = ['manual', 'schedule', 'webhook'] as const
export type ScanTrigger = (typeof SCAN_TRIGGERS)[number]

export const SCANNER_RUN_STATUSES = [
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
] as const
export type ScannerRunStatus = (typeof SCANNER_RUN_STATUSES)[number]

export const repositories = pgTable('repositories', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  branch: text('branch').notNull().default('main'),
  cronExpression: text('cron_expression').notNull().default('0 3 * * *'),
  enabled: boolean('enabled').notNull().default(true),
  nextScanAt: timestamp('next_scan_at', { withTimezone: true }),
  lastScanAt: timestamp('last_scan_at', { withTimezone: true }),
  createdAt,
  updatedAt,
})

/** GitHub delivery IDs already accepted, retained to reject signed replays. */
export const githubWebhookDeliveries = pgTable('github_webhook_deliveries', {
  deliveryId: text('delivery_id').primaryKey(),
  event: text('event').notNull(),
  createdAt,
})

/**
 * Persistent, source-grounded knowledge about a repository. The overview is
 * a markdown document written by the knowledge agent; `sources` records the
 * content hash of every file it relied on so the next scan can detect stale
 * sections without re-reading the whole repository.
 */
export const repositoryKnowledge = pgTable('repository_knowledge', {
  id: serial('id').primaryKey(),
  repositoryId: integer('repository_id')
    .notNull()
    .references(() => repositories.id, { onDelete: 'cascade' })
    .unique(),
  overview: text('overview').notNull(),
  /** Machine-readable summary the knowledge agent also returns. */
  summary: jsonb('summary')
    .$type<RepositoryKnowledgeSummary>()
    .notNull()
    .default({ languages: [], frameworks: [], subsystems: [], concepts: [] }),
  sources: jsonb('sources').$type<KnowledgeSource[]>().notNull().default([]),
  commitSha: text('commit_sha'),
  fileCount: integer('file_count'),
  refreshedAt: timestamp('refreshed_at', { withTimezone: true }),
  createdAt,
  updatedAt,
})

/** Editable, security-specific context used by discovery and prioritization. */
export const repositorySecurityProfiles = pgTable(
  'repository_security_profiles',
  {
    id: serial('id').primaryKey(),
    repositoryId: integer('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' })
      .unique(),
    profile: jsonb('profile').$type<SecurityProfile>().notNull(),
    version: integer('version').notNull().default(1),
    source: text('source')
      .$type<'generated' | 'operator' | 'repository'>()
      .notNull()
      .default('generated'),
    generatedAt: timestamp('generated_at', { withTimezone: true }),
    createdAt,
    updatedAt,
  },
)

export interface KnowledgeSource {
  readonly path: string
  readonly hash: string
}

export interface KnowledgeSubsystem {
  readonly name: string
  readonly paths: string[]
  readonly responsibility: string
}

export interface RepositoryKnowledgeSummary {
  readonly languages: string[]
  readonly frameworks: string[]
  readonly subsystems: KnowledgeSubsystem[]
  readonly concepts: string[]
}

export const scans = pgTable(
  'scans',
  {
    id: serial('id').primaryKey(),
    repositoryId: integer('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    status: text('status').$type<ScanStatus>().notNull().default('queued'),
    trigger: text('trigger').$type<ScanTrigger>().notNull().default('manual'),
    mode: text('mode').$type<ScanMode>().notNull().default('standard'),
    target: jsonb('target')
      .$type<ScanTarget>()
      .notNull()
      .default({ kind: 'repository' }),
    maxCostUsd: real('max_cost_usd'),
    cancellationRequestedAt: timestamp('cancellation_requested_at', {
      withTimezone: true,
    }),
    commitSha: text('commit_sha'),
    branch: text('branch'),
    fileCount: integer('file_count'),
    /** Current pipeline phase for the UI, e.g. "cloning", "scanning". */
    phase: text('phase'),
    eveSessionId: text('eve_session_id'),
    gitnexusUsed: boolean('gitnexus_used').notNull().default(false),
    knowledgeRefreshed: boolean('knowledge_refreshed').notNull().default(false),
    overallScore: real('overall_score'),
    grade: text('grade'),
    counts: jsonb('counts').$type<FindingCounts>(),
    /** Model used by the Eve agents for this scan, for cost attribution. */
    model: text('model'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    cacheReadTokens: integer('cache_read_tokens'),
    cacheWriteTokens: integer('cache_write_tokens'),
    /** Estimated model cost in USD; null when the model has no known rate. */
    estimatedCostUsd: real('estimated_cost_usd'),
    /** Number of model calls (root turn plus every subagent step). */
    modelCalls: integer('model_calls'),
    coverage: jsonb('coverage').$type<ScanCoverage>(),
    manifest: jsonb('manifest').$type<ScanManifest>(),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt,
  },
  (table) => [
    index('scans_repository_created_idx').on(
      table.repositoryId,
      table.createdAt,
    ),
    uniqueIndex('scans_repository_active_idx')
      .on(table.repositoryId)
      .where(sql`${table.status} in ('queued', 'running')`),
  ],
)

export interface FindingCounts {
  readonly new: number
  readonly active: number
  readonly improved: number
  readonly resolved: number
  readonly regressed: number
}

export const scannerRuns = pgTable(
  'scanner_runs',
  {
    id: serial('id').primaryKey(),
    scanId: integer('scan_id')
      .notNull()
      .references(() => scans.id, { onDelete: 'cascade' }),
    scannerId: text('scanner_id').notNull(),
    status: text('status')
      .$type<ScannerRunStatus>()
      .notNull()
      .default('pending'),
    score: real('score'),
    summary: text('summary'),
    fixPrompt: text('fix_prompt'),
    error: text('error'),
    eveSessionId: text('eve_session_id'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    cacheReadTokens: integer('cache_read_tokens'),
    cacheWriteTokens: integer('cache_write_tokens'),
    estimatedCostUsd: real('estimated_cost_usd'),
    modelCalls: integer('model_calls'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('scanner_runs_scan_scanner_idx').on(
      table.scanId,
      table.scannerId,
    ),
  ],
)

/**
 * A logical finding that persists across scans. Its `fingerprint` identifies
 * the problem; the latest content lives here and every observation is an
 * occurrence.
 */
export const findings = pgTable(
  'findings',
  {
    id: serial('id').primaryKey(),
    repositoryId: integer('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    scannerId: text('scanner_id').notNull(),
    fingerprint: text('fingerprint').notNull(),
    state: text('state').$type<FindingState>().notNull().default('new'),
    title: text('title').notNull(),
    severity: text('severity').$type<Severity>().notNull(),
    confidence: text('confidence').$type<Confidence>().notNull(),
    description: text('description').notNull(),
    whyItMatters: text('why_it_matters').notNull(),
    recommendation: text('recommendation').notNull(),
    effort: text('effort').$type<Effort>().notNull(),
    locations: jsonb('locations')
      .$type<FindingLocation[]>()
      .notNull()
      .default([]),
    classification: jsonb('classification').$type<FindingClassification>(),
    securityContext: jsonb('security_context').$type<SecurityContext>(),
    rootCause: text('root_cause'),
    codeEvidence: jsonb('code_evidence').$type<CodeEvidence[]>(),
    attackPath: jsonb('attack_path').$type<AttackPath>(),
    validationPlan: jsonb('validation_plan').$type<ValidationPlan>(),
    remediationTests: jsonb('remediation_tests').$type<string[]>(),
    preventiveControls: jsonb('preventive_controls').$type<string[]>(),
    vulnerability: jsonb('vulnerability').$type<VulnerabilityMetadata>(),
    priority: text('priority').$type<FindingPriority>(),
    priorityScore: real('priority_score'),
    priorityReasons: jsonb('priority_reasons')
      .$type<string[]>()
      .notNull()
      .default([]),
    /** Manual operator decision; null means lifecycle state comes from scans. */
    disposition: text('disposition').$type<FindingDisposition>(),
    dispositionNote: text('disposition_note'),
    triagedAt: timestamp('triaged_at', { withTimezone: true }),
    firstSeenScanId: integer('first_seen_scan_id').references(() => scans.id, {
      onDelete: 'set null',
    }),
    lastSeenScanId: integer('last_seen_scan_id').references(() => scans.id, {
      onDelete: 'set null',
    }),
    resolvedScanId: integer('resolved_scan_id').references(() => scans.id, {
      onDelete: 'set null',
    }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('findings_repository_scanner_fingerprint_idx').on(
      table.repositoryId,
      table.scannerId,
      table.fingerprint,
    ),
    index('findings_repository_state_idx').on(table.repositoryId, table.state),
  ],
)

/** One observation of a logical finding in one scan. */
export const findingOccurrences = pgTable(
  'finding_occurrences',
  {
    id: serial('id').primaryKey(),
    findingId: integer('finding_id')
      .notNull()
      .references(() => findings.id, { onDelete: 'cascade' }),
    scanId: integer('scan_id')
      .notNull()
      .references(() => scans.id, { onDelete: 'cascade' }),
    state: text('state').$type<FindingState>().notNull(),
    severity: text('severity').$type<Severity>().notNull(),
    confidence: text('confidence').$type<Confidence>().notNull(),
    classification: jsonb('classification').$type<FindingClassification>(),
    securityContext: jsonb('security_context').$type<SecurityContext>(),
    rootCause: text('root_cause'),
    codeEvidence: jsonb('code_evidence').$type<CodeEvidence[]>(),
    attackPath: jsonb('attack_path').$type<AttackPath>(),
    validationPlan: jsonb('validation_plan').$type<ValidationPlan>(),
    vulnerability: jsonb('vulnerability').$type<VulnerabilityMetadata>(),
    priority: text('priority').$type<FindingPriority>(),
    priorityScore: real('priority_score'),
    priorityReasons: jsonb('priority_reasons')
      .$type<string[]>()
      .notNull()
      .default([]),
    note: text('note'),
    createdAt,
  },
  (table) => [
    uniqueIndex('finding_occurrences_finding_scan_idx').on(
      table.findingId,
      table.scanId,
    ),
    index('finding_occurrences_scan_idx').on(table.scanId),
  ],
)

export const findingValidations = pgTable(
  'finding_validations',
  {
    id: serial('id').primaryKey(),
    findingId: integer('finding_id')
      .notNull()
      .references(() => findings.id, { onDelete: 'cascade' }),
    occurrenceId: integer('occurrence_id').references(
      () => findingOccurrences.id,
      { onDelete: 'set null' },
    ),
    status: text('status').$type<ValidationStatus>().notNull(),
    method: text('method').notNull(),
    summary: text('summary').notNull(),
    commands: jsonb('commands')
      .$type<ValidationCommandResult[]>()
      .notNull()
      .default([]),
    proofGaps: jsonb('proof_gaps').$type<string[]>().notNull().default([]),
    runner: text('runner').notNull(),
    createdAt,
  },
  (table) => [index('finding_validations_finding_idx').on(table.findingId)],
)

export const scanArtifacts = pgTable(
  'scan_artifacts',
  {
    id: serial('id').primaryKey(),
    scanId: integer('scan_id')
      .notNull()
      .references(() => scans.id, { onDelete: 'cascade' }),
    kind: text('kind')
      .$type<'manifest' | 'findings' | 'coverage' | 'report' | 'sarif'>()
      .notNull(),
    contentType: text('content_type').notNull(),
    sha256: text('sha256').notNull(),
    contents: text('contents').notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex('scan_artifacts_scan_kind_idx').on(table.scanId, table.kind),
  ],
)

export const findingPatches = pgTable(
  'finding_patches',
  {
    id: serial('id').primaryKey(),
    findingId: integer('finding_id')
      .notNull()
      .references(() => findings.id, { onDelete: 'cascade' }),
    sourceScanId: integer('source_scan_id').references(() => scans.id, {
      onDelete: 'set null',
    }),
    status: text('status')
      .$type<
        | 'generating'
        | 'proposed'
        | 'accepted'
        | 'rejected'
        | 'verified'
        | 'failed'
      >()
      .notNull()
      .default('proposed'),
    diff: text('diff').notNull(),
    summary: text('summary').notNull(),
    verification: jsonb('verification').$type<{
      status: ValidationStatus
      commands: ValidationCommandResult[]
      proofGaps: string[]
    }>(),
    /** Eve root session used to generate this patch, for usage attribution. */
    eveSessionId: text('eve_session_id'),
    model: text('model'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    cacheReadTokens: integer('cache_read_tokens'),
    cacheWriteTokens: integer('cache_write_tokens'),
    estimatedCostUsd: real('estimated_cost_usd'),
    modelCalls: integer('model_calls'),
    createdAt,
    updatedAt,
  },
  (table) => [
    index('finding_patches_finding_idx').on(table.findingId),
    uniqueIndex('finding_patches_active_idx')
      .on(table.findingId)
      .where(sql`${table.status} in ('generating', 'proposed', 'verified')`),
  ],
)

export const repositoriesRelations = relations(
  repositories,
  ({ many, one }) => ({
    scans: many(scans),
    findings: many(findings),
    knowledge: one(repositoryKnowledge, {
      fields: [repositories.id],
      references: [repositoryKnowledge.repositoryId],
    }),
    securityProfile: one(repositorySecurityProfiles, {
      fields: [repositories.id],
      references: [repositorySecurityProfiles.repositoryId],
    }),
  }),
)

export const repositoryKnowledgeRelations = relations(
  repositoryKnowledge,
  ({ one }) => ({
    repository: one(repositories, {
      fields: [repositoryKnowledge.repositoryId],
      references: [repositories.id],
    }),
  }),
)

export const repositorySecurityProfilesRelations = relations(
  repositorySecurityProfiles,
  ({ one }) => ({
    repository: one(repositories, {
      fields: [repositorySecurityProfiles.repositoryId],
      references: [repositories.id],
    }),
  }),
)

export const scansRelations = relations(scans, ({ one, many }) => ({
  repository: one(repositories, {
    fields: [scans.repositoryId],
    references: [repositories.id],
  }),
  scannerRuns: many(scannerRuns),
  occurrences: many(findingOccurrences),
  artifacts: many(scanArtifacts),
  patches: many(findingPatches),
}))

export const scannerRunsRelations = relations(scannerRuns, ({ one }) => ({
  scan: one(scans, { fields: [scannerRuns.scanId], references: [scans.id] }),
}))

export const findingsRelations = relations(findings, ({ one, many }) => ({
  repository: one(repositories, {
    fields: [findings.repositoryId],
    references: [repositories.id],
  }),
  occurrences: many(findingOccurrences),
  validations: many(findingValidations),
  patches: many(findingPatches),
}))

export const findingOccurrencesRelations = relations(
  findingOccurrences,
  ({ one }) => ({
    finding: one(findings, {
      fields: [findingOccurrences.findingId],
      references: [findings.id],
    }),
    scan: one(scans, {
      fields: [findingOccurrences.scanId],
      references: [scans.id],
    }),
  }),
)

export const findingValidationsRelations = relations(
  findingValidations,
  ({ one }) => ({
    finding: one(findings, {
      fields: [findingValidations.findingId],
      references: [findings.id],
    }),
    occurrence: one(findingOccurrences, {
      fields: [findingValidations.occurrenceId],
      references: [findingOccurrences.id],
    }),
  }),
)

export const findingPatchesRelations = relations(findingPatches, ({ one }) => ({
  finding: one(findings, {
    fields: [findingPatches.findingId],
    references: [findings.id],
  }),
  sourceScan: one(scans, {
    fields: [findingPatches.sourceScanId],
    references: [scans.id],
  }),
}))

export const scanArtifactsRelations = relations(scanArtifacts, ({ one }) => ({
  scan: one(scans, {
    fields: [scanArtifacts.scanId],
    references: [scans.id],
  }),
}))

export type Repository = typeof repositories.$inferSelect
export type Scan = typeof scans.$inferSelect
export type ScannerRun = typeof scannerRuns.$inferSelect
export type Finding = typeof findings.$inferSelect
export type FindingOccurrence = typeof findingOccurrences.$inferSelect
export type RepositoryKnowledge = typeof repositoryKnowledge.$inferSelect
export type RepositorySecurityProfile =
  typeof repositorySecurityProfiles.$inferSelect
export type FindingValidationRecord = typeof findingValidations.$inferSelect
export type FindingPatch = typeof findingPatches.$inferSelect
export type ScanArtifact = typeof scanArtifacts.$inferSelect
