import { z } from 'zod'

const timestamp = z.string()
const nullableTimestamp = timestamp.nullable()
const nullableString = z.string().nullable()
const nullableNumber = z.number().nullable()
const nullableJson = z.unknown().nullable()

export const scanSummaryDtoSchema = z.object({
  id: z.number().int().positive(),
  repositoryId: z.number().int().positive(),
  status: z.enum([
    'queued',
    'running',
    'completed',
    'partial',
    'failed',
    'cancelled',
  ]),
  trigger: z.enum(['manual', 'schedule']),
  mode: z.string(),
  target: z.unknown(),
  maxCostUsd: nullableNumber,
  maxInputTokens: z.number().int(),
  cancellationRequestedAt: nullableTimestamp,
  commitSha: nullableString,
  branch: nullableString,
  fileCount: z.number().int().nullable(),
  phase: nullableString,
  progress: nullableJson,
  gitnexusUsed: z.boolean(),
  knowledgeRefreshed: z.boolean(),
  overallScore: nullableNumber,
  grade: nullableString,
  counts: nullableJson,
  model: nullableString,
  estimatedCostUsd: nullableNumber,
  modelCalls: z.number().int().nullable(),
  coverage: nullableJson,
  investigation: nullableJson,
  error: nullableString,
  startedAt: nullableTimestamp,
  finishedAt: nullableTimestamp,
  createdAt: timestamp,
})

export const findingSummaryDtoSchema = z.object({
  id: z.number().int().positive(),
  repositoryId: z.number().int().positive(),
  scannerId: z.string(),
  fingerprint: z.string(),
  state: z.string(),
  title: z.string(),
  severity: z.string(),
  confidence: z.string(),
  description: z.string(),
  whyItMatters: z.string(),
  recommendation: z.string(),
  effort: z.string(),
  subject: nullableJson,
  evidence: z.array(z.unknown()),
  locations: z.array(z.unknown()),
  classification: nullableJson,
  securityContext: nullableJson,
  rootCause: nullableString,
  codeEvidence: nullableJson,
  attackPath: nullableJson,
  validationPlan: nullableJson,
  remediationTests: nullableJson,
  preventiveControls: nullableJson,
  vulnerability: nullableJson,
  priority: nullableString,
  priorityScore: nullableNumber,
  priorityReasons: z.array(z.string()),
  disposition: nullableString,
  dispositionNote: nullableString,
  triagedAt: nullableTimestamp,
  firstSeenScanId: z.number().int().nullable(),
  lastSeenScanId: z.number().int().nullable(),
  resolvedScanId: z.number().int().nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
})

export const repositorySummaryDtoSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  url: z.string(),
  branch: z.string(),
  scheduleEnabled: z.boolean(),
  scheduleCronExpression: nullableString,
  nextScheduledScanAt: nullableTimestamp,
  lastScanAt: nullableTimestamp,
  createdAt: timestamp,
  updatedAt: timestamp,
  latestScan: scanSummaryDtoSchema
    .pick({
      id: true,
      status: true,
      overallScore: true,
      grade: true,
      createdAt: true,
      finishedAt: true,
    })
    .nullable(),
})

const repositoryReferenceSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
})

const scannerRunDtoSchema = z.object({
  id: z.number().int().positive(),
  scanId: z.number().int().positive(),
  scannerId: z.string(),
  requestedModel: z.string(),
  requestedEffort: z.string(),
  status: z.string(),
  score: nullableNumber,
  summary: nullableString,
  investigation: nullableJson,
  error: nullableString,
  estimatedCostUsd: nullableNumber,
  modelCalls: z.number().int().nullable(),
  startedAt: nullableTimestamp,
  finishedAt: nullableTimestamp,
})

const occurrenceDtoSchema = z.object({
  id: z.number().int().positive(),
  findingId: z.number().int().positive(),
  scanId: z.number().int().positive(),
  state: z.string(),
  severity: z.string(),
  confidence: z.string(),
  subject: nullableJson,
  evidence: z.array(z.unknown()),
  locations: z.array(z.unknown()).optional(),
  note: nullableString,
  createdAt: timestamp,
  finding: findingSummaryDtoSchema.optional(),
})

const validationDtoSchema = z.object({
  id: z.number().int().positive(),
  findingId: z.number().int().positive(),
  occurrenceId: z.number().int().nullable(),
  status: z.string(),
  method: z.string(),
  summary: z.string(),
  commands: z.array(z.unknown()),
  proofGaps: z.array(z.string()),
  runner: z.string(),
  createdAt: timestamp,
})

const patchDtoSchema = z.object({
  id: z.number().int().positive(),
  findingId: z.number().int().positive(),
  sourceScanId: z.number().int().nullable(),
  status: z.string(),
  summary: z.string(),
  verification: nullableJson,
  model: nullableString,
  estimatedCostUsd: nullableNumber,
  modelCalls: z.number().int().nullable(),
  startedAt: nullableTimestamp,
  finishedAt: nullableTimestamp,
  createdAt: timestamp,
  updatedAt: timestamp,
})

const findingEventDtoSchema = z.object({
  id: z.number().int().positive(),
  findingId: z.number().int().positive(),
  scanId: z.number().int().nullable(),
  kind: z.string(),
  actor: z.string(),
  fromState: nullableString,
  toState: z.string(),
  disposition: nullableString,
  note: nullableString,
  createdAt: timestamp,
})

export const repositoryDetailDtoSchema = repositorySummaryDtoSchema
  .omit({ latestScan: true })
  .extend({
    scans: z.array(scanSummaryDtoSchema),
    findings: z.array(findingSummaryDtoSchema),
    knowledge: z
      .object({
        overview: z.string(),
        summary: z.unknown(),
        commitSha: nullableString,
        fileCount: z.number().int().nullable(),
        refreshedAt: nullableTimestamp,
      })
      .nullable(),
  })

export const scanDetailDtoSchema = scanSummaryDtoSchema.extend({
  repository: repositoryReferenceSchema,
  scannerRuns: z.array(scannerRunDtoSchema),
  artifacts: z.array(
    z.object({
      kind: z.string(),
      contentType: z.string(),
      sha256: z.string(),
    }),
  ),
  occurrences: z.array(occurrenceDtoSchema),
})

export const findingDetailDtoSchema = findingSummaryDtoSchema.extend({
  repository: repositoryReferenceSchema,
  occurrences: z.array(occurrenceDtoSchema.omit({ finding: true })),
  validations: z.array(validationDtoSchema),
  patches: z.array(patchDtoSchema),
  events: z.array(findingEventDtoSchema),
})

export const repositoryListOutputSchema = z.object({
  repositories: z.array(repositorySummaryDtoSchema),
  total: z.number().int(),
  offset: z.number().int(),
  limit: z.number().int(),
  hasMore: z.boolean(),
})
export const repositoryOutputSchema = z.object({
  repository: repositoryDetailDtoSchema.nullable(),
})
export const scanListOutputSchema = z.object({
  scans: z.array(
    scanSummaryDtoSchema.extend({ repository: repositoryReferenceSchema }),
  ),
  total: z.number().int(),
  offset: z.number().int(),
  limit: z.number().int(),
  hasMore: z.boolean(),
})
export const scanOutputSchema = z.object({
  scan: scanDetailDtoSchema.nullable(),
})
export const findingOutputSchema = z.object({
  finding: findingDetailDtoSchema.nullable(),
})
export const findingMutationOutputSchema = z.object({
  finding: z.object({
    id: z.number().int().positive(),
    state: z.string(),
    disposition: nullableString,
  }),
})

export type RepositoryListOutput = z.infer<typeof repositoryListOutputSchema>
export type RepositoryOutput = z.infer<typeof repositoryOutputSchema>
export type ScanListOutput = z.infer<typeof scanListOutputSchema>
export type ScanOutput = z.infer<typeof scanOutputSchema>
export type FindingOutput = z.infer<typeof findingOutputSchema>
export type FindingMutationOutput = z.infer<typeof findingMutationOutputSchema>

/** Converts dates to wire strings and strips fields absent from the DTO. */
export function toDto<T>(schema: z.ZodType<T>, value: unknown): T {
  return schema.parse(JSON.parse(JSON.stringify(value)) as unknown)
}
