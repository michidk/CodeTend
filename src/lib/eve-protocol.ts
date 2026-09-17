import { z } from 'zod'
import { agentExecutionProfileSchema } from '@/lib/agent-execution'
import {
  codeEvidenceSchema,
  findingClassificationSchema,
  findingLocationSchema,
  scannerResultSchema,
  securityContextSchema,
  validationPlanSchema,
} from '@/lib/findings'
import {
  investigationEvidenceSchema,
  investigationReportSchema,
  investigationSubjectSchema,
  scanCoverageSchema,
  scanTargetSchema,
  securityProfileSchema,
} from '@/lib/security-scans'

const validationSettingsSchema = z.object({
  enabled: z.boolean(),
  runner: z.enum(['auto', 'docker', 'disabled']),
  image: z.string(),
})

const knowledgeSummarySchema = z.object({
  languages: z.array(z.string()).default([]),
  frameworks: z.array(z.string()).default([]),
  subsystems: z
    .array(
      z.object({
        name: z.string(),
        paths: z.array(z.string()).default([]),
        responsibility: z.string().default(''),
      }),
    )
    .default([]),
  concepts: z.array(z.string()).default([]),
  securityProfile: securityProfileSchema.optional(),
})

const subsystemDependencyGraphSchema = z
  .object({
    edges: z
      .array(
        z.object({
          source: z.string(),
          target: z.string(),
          weight: z.number(),
        }),
      )
      .default([]),
    cycles: z
      .array(
        z.object({
          files: z.array(z.string()).default([]),
          subsystems: z.array(z.string()).default([]),
        }),
      )
      .default([]),
    cycleStatus: z.enum(['clean', 'cycles_found', 'unavailable']),
    componentCount: z.number().nullable(),
  })
  .default({
    edges: [],
    cycles: [],
    cycleStatus: 'unavailable',
    componentCount: null,
  })

const dependencyImpactEvidenceSchema = z.object({
  path: z.string().min(1).max(1_000),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  symbol: z.string().min(1).max(200).optional(),
  role: z.enum(['source', 'control', 'sink', 'supporting', 'test']),
  summary: z.string().min(5).max(1_000),
})

const dependencyImpactAssessmentSchema = z.object({
  package: z.object({
    ecosystem: z.string().min(1),
    name: z.string().min(1),
    version: z.string().min(1),
  }),
  advisoryIds: z.array(z.string().min(1)).min(1),
  verdict: z.enum(['confirmed', 'not-confirmed']),
  rationale: z.string().min(5).max(2_000),
  inspectedEvidence: z.array(dependencyImpactEvidenceSchema).max(20),
})

const dependencyAuditResultSchema = z.object({
  status: z.enum(['completed', 'unavailable', 'failed']),
  report: z.unknown().optional(),
  error: z.string().optional(),
  toolVersion: z.string().optional(),
  exploitabilityAssessments: z
    .array(dependencyImpactAssessmentSchema)
    .default([]),
})

const scannerOutcomeSchema = z.object({
  scannerId: z.string(),
  status: z.enum(['completed', 'failed']),
  result: scannerResultSchema.optional(),
  error: z.string().optional(),
  startedAt: z.string(),
  finishedAt: z.string(),
})

const candidateValidationSchema = z.object({
  scannerId: z.string(),
  fingerprint: z.string(),
  status: z.enum([
    'not_run',
    'confirmed',
    'not_reproduced',
    'inconclusive',
    'unavailable',
    'error',
  ]),
  method: z.string(),
  summary: z.string(),
  commands: z.array(
    z.object({
      command: z.string(),
      purpose: z.string(),
      timeoutSeconds: z.number(),
      exitCode: z.number().nullable(),
      stdout: z.string(),
      stderr: z.string(),
      timedOut: z.boolean(),
      durationMs: z.number(),
    }),
  ),
  proofGaps: z.array(z.string()),
  runner: z.string(),
  validatedAt: z.string(),
})

const knowledgeResultSchema = z.object({
  refreshed: z.boolean(),
  overview: z.string(),
  summary: knowledgeSummarySchema,
  sources: z.array(z.object({ path: z.string(), hash: z.string() })),
  reason: z.string(),
  dependencyGraph: subsystemDependencyGraphSchema,
})

export const scanRequestSchema = z.object({
  contractVersion: z.literal(1),
  executionProfile: agentExecutionProfileSchema,
  scanId: z.number().int(),
  repositoryId: z.number().int().positive(),
  repositoryName: z.string().min(1),
  repositoryUrl: z.string().min(1),
  branch: z.string().min(1),
  gitnexus: z.boolean(),
  knowledge: z
    .object({
      overview: z.string(),
      summary: knowledgeSummarySchema,
      sources: z.array(z.object({ path: z.string(), hash: z.string() })),
      fileCount: z.number().int().nonnegative().nullable(),
    })
    .nullable(),
  previousCommitSha: z.string().nullable(),
  target: scanTargetSchema,
  maxInputTokens: z.number().int().positive(),
  maxCostUsd: z.number().nonnegative().nullable(),
  securityProfile: securityProfileSchema.nullable(),
  validation: validationSettingsSchema,
  dependencyAudit: z.boolean().default(false),
  scanners: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      prompt: z.string(),
      executionProfile: agentExecutionProfileSchema,
      hypotheses: z.array(
        z.object({
          findingId: z.number().int().positive(),
          fingerprint: z.string(),
          title: z.string(),
          severity: z.string(),
          description: z.string(),
          classification: findingClassificationSchema.nullish(),
          securityContext: securityContextSchema.nullish(),
          disposition: z.enum(['false_positive', 'accepted_risk']).nullish(),
          dispositionNote: z.string().nullish(),
          subject: investigationSubjectSchema.nullish(),
          evidence: z.array(investigationEvidenceSchema).optional(),
          locations: z.array(findingLocationSchema),
        }),
      ),
      attentionHistory: z.array(investigationReportSchema),
    }),
  ),
  outputSchema: z.record(z.string(), z.unknown()),
})

export const patchRequestSchema = z.object({
  contractVersion: z.literal(1),
  executionProfile: agentExecutionProfileSchema,
  patchId: z.number().int().positive(),
  repositoryId: z.number().int().positive(),
  repositoryName: z.string().min(1),
  repositoryUrl: z.string().min(1),
  branch: z.string().min(1),
  revision: z.string().min(1),
  finding: z.object({
    id: z.number().int().positive(),
    title: z.string(),
    severity: z.string(),
    description: z.string(),
    rootCause: z.string().nullable(),
    whyItMatters: z.string(),
    recommendation: z.string(),
    locations: z.array(findingLocationSchema),
    codeEvidence: z.array(codeEvidenceSchema).nullable(),
    validationPlan: validationPlanSchema.nullable(),
    remediationTests: z.array(z.string()).nullable(),
    preventiveControls: z.array(z.string()).nullable(),
  }),
  validation: validationSettingsSchema,
})

export const scanResultSchema = z.object({
  scanId: z.number().int(),
  commitSha: z.string(),
  fileCount: z.number().int(),
  gitnexusUsed: z.boolean(),
  knowledge: knowledgeResultSchema,
  securityProfile: z.object({
    profile: securityProfileSchema,
    generated: z.boolean(),
  }),
  dependencyAudit: dependencyAuditResultSchema.default({
    status: 'unavailable',
    error: 'This scan predates dependency auditing.',
    exploitabilityAssessments: [],
  }),
  scanners: z.array(scannerOutcomeSchema),
  investigation: investigationReportSchema,
  coverage: scanCoverageSchema.default({
    completeness: 'unknown',
    reviewed: [],
    deferred: [],
    excluded: [],
    openQuestions: [],
  }),
  validations: z.array(candidateValidationSchema).default([]),
  finishedAt: z.string(),
})

export const scanCheckpointSchema = scanResultSchema
  .pick({
    scanId: true,
    commitSha: true,
    fileCount: true,
    gitnexusUsed: true,
    knowledge: true,
    securityProfile: true,
    dependencyAudit: true,
    scanners: true,
  })
  .extend({
    version: z.literal(1),
    requestFingerprint: z.string().min(1),
    updatedAt: z.string(),
  })

export const patchResultSchema = z.object({
  patchId: z.number().int().positive(),
  status: z.enum(['proposed', 'verified', 'failed']),
  summary: z.string(),
  diff: z.string(),
  changedFiles: z.array(z.string()),
  testRecommendations: z.array(z.string()),
  verification: candidateValidationSchema.nullable(),
  error: z.string().optional(),
  finishedAt: z.string(),
})

export type PatchRequest = z.infer<typeof patchRequestSchema>
export type PatchResult = z.infer<typeof patchResultSchema>
export type ScanCheckpoint = z.infer<typeof scanCheckpointSchema>
export type ScanRequest = z.infer<typeof scanRequestSchema>
export type ScanResult = z.infer<typeof scanResultSchema>
