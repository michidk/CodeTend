import { relations } from 'drizzle-orm'
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
  Confidence,
  Effort,
  FindingLocation,
  FindingState,
  Severity,
} from '@/lib/findings'

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
] as const
export type ScanStatus = (typeof SCAN_STATUSES)[number]

export const SCAN_TRIGGERS = ['manual', 'schedule', 'webhook'] as const
export type ScanTrigger = (typeof SCAN_TRIGGERS)[number]

export const SCANNER_RUN_STATUSES = [
  'pending',
  'running',
  'completed',
  'failed',
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

export const repositoriesRelations = relations(
  repositories,
  ({ many, one }) => ({
    scans: many(scans),
    findings: many(findings),
    knowledge: one(repositoryKnowledge, {
      fields: [repositories.id],
      references: [repositoryKnowledge.repositoryId],
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

export const scansRelations = relations(scans, ({ one, many }) => ({
  repository: one(repositories, {
    fields: [scans.repositoryId],
    references: [repositories.id],
  }),
  scannerRuns: many(scannerRuns),
  occurrences: many(findingOccurrences),
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

export type Repository = typeof repositories.$inferSelect
export type Scan = typeof scans.$inferSelect
export type ScannerRun = typeof scannerRuns.$inferSelect
export type Finding = typeof findings.$inferSelect
export type FindingOccurrence = typeof findingOccurrences.$inferSelect
export type RepositoryKnowledge = typeof repositoryKnowledge.$inferSelect
