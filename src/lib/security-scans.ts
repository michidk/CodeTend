import { z } from 'zod'

export const SCAN_MODES = ['standard', 'deep'] as const
export type ScanMode = (typeof SCAN_MODES)[number]

export const DEFAULT_SCAN_INPUT_TOKEN_BUDGET = 250_000
export const MAX_SCAN_INPUT_TOKEN_BUDGET = 5_000_000
export const SCAN_INPUT_TOKEN_BUDGET_PRESETS = [
  100_000, 250_000, 500_000,
] as const
export const DEFAULT_SCAN_FILE_GLOB =
  '**/*.{c,cc,cpp,cxx,cs,css,dart,ex,exs,fs,fsx,go,gql,graphql,groovy,h,hh,hpp,hxx,hs,htm,html,java,js,jsx,kt,kts,less,lua,m,mjs,mm,php,pl,pm,proto,py,pyi,r,rb,rs,sass,scala,scss,sh,sol,sql,svelte,swift,tf,ts,tsx,vue,zig}'
const repositoryPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((path) => !path.startsWith('/') && !path.includes('\\'), {
    message: 'Use a repository-relative POSIX path.',
  })
  .refine((path) => path.split('/').every((segment) => segment !== '..'), {
    message: 'Path traversal is not allowed.',
  })

const commitRevisionSchema = z
  .string()
  .regex(/^[0-9a-f]{7,64}$/i, 'Use a Git commit SHA.')

export const scanTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('repository') }),
  z.object({
    kind: z.literal('paths'),
    paths: z.array(repositoryPathSchema).min(1).max(50),
  }),
  z.object({
    kind: z.literal('diff'),
    base: commitRevisionSchema,
    head: commitRevisionSchema,
  }),
])
export type ScanTarget = z.infer<typeof scanTargetSchema>

export const securityProfileSchema = z.object({
  projectOverview: z.string().max(10_000).default(''),
  assets: z.array(z.string().min(1).max(500)).max(100).default([]),
  entryPoints: z.array(z.string().min(1).max(500)).max(100).default([]),
  trustBoundaries: z.array(z.string().min(1).max(1_000)).max(100).default([]),
  authAssumptions: z.array(z.string().min(1).max(1_000)).max(100).default([]),
  sensitiveDataPaths: z
    .array(z.string().min(1).max(1_000))
    .max(100)
    .default([]),
  privilegedActions: z.array(z.string().min(1).max(1_000)).max(100).default([]),
  securityInvariants: z
    .array(z.string().min(1).max(1_000))
    .max(100)
    .default([]),
  priorities: z.array(z.string().min(1).max(1_000)).max(100).default([]),
  exclusions: z.array(z.string().min(1).max(1_000)).max(100).default([]),
})
export type SecurityProfile = z.infer<typeof securityProfileSchema>

export const investigationSubjectSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('repository'),
    aspect: z.string().min(1).max(500),
  }),
  z.object({
    kind: z.literal('module'),
    name: z.string().min(1).max(300),
    paths: z.array(repositoryPathSchema).max(50).default([]),
  }),
  z.object({
    kind: z.literal('dependency'),
    from: z.string().min(1).max(500),
    to: z.string().min(1).max(500),
  }),
  z.object({ kind: z.literal('file'), path: repositoryPathSchema }),
  z.object({
    kind: z.literal('symbol'),
    path: repositoryPathSchema,
    symbol: z.string().min(1).max(300),
  }),
])
export type InvestigationSubject = z.infer<typeof investigationSubjectSchema>

export const investigationEvidenceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('file'),
    path: repositoryPathSchema,
    startLine: z.number().int().positive().optional(),
    endLine: z.number().int().positive().optional(),
    summary: z.string().min(1).max(1_000),
  }),
  z.object({
    kind: z.literal('repository-structure'),
    paths: z.array(repositoryPathSchema).min(1).max(100),
    summary: z.string().min(1).max(1_000),
  }),
  z.object({
    kind: z.literal('dependency-edge'),
    from: z.string().min(1).max(500),
    to: z.string().min(1).max(500),
    summary: z.string().min(1).max(1_000),
  }),
  z.object({
    kind: z.literal('tool-result'),
    tool: z.string().min(1).max(200),
    summary: z.string().min(1).max(1_000),
  }),
  z.object({
    kind: z.literal('command'),
    command: z.string().min(1).max(1_000),
    summary: z.string().min(1).max(1_000),
  }),
])
export type InvestigationEvidence = z.infer<typeof investigationEvidenceSchema>

export const investigationReportSchema = z.object({
  strategy: z.string().min(10).max(3_000),
  focusAreas: z.array(investigationSubjectSchema).max(100).default([]),
  evidence: z.array(investigationEvidenceSchema).max(300).default([]),
  blindSpots: z.array(z.string().min(1).max(1_000)).max(100).default([]),
  confidence: z.enum(['low', 'medium', 'high']),
})
export type InvestigationReport = z.infer<typeof investigationReportSchema>

export const scanCoverageEntrySchema = z.object({
  path: repositoryPathSchema,
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  summary: z.string().min(1).max(1_000),
})
export type ScanCoverageEntry = z.infer<typeof scanCoverageEntrySchema>

export const scanCoverageSchema = z.object({
  completeness: z.enum(['complete', 'partial', 'unknown']),
  reviewed: z.array(scanCoverageEntrySchema).max(500).default([]),
  deferred: z
    .array(z.object({ path: repositoryPathSchema, reason: z.string() }))
    .max(200)
    .default([]),
  excluded: z
    .array(z.object({ path: repositoryPathSchema, reason: z.string() }))
    .max(200)
    .default([]),
  openQuestions: z.array(z.string()).max(100).default([]),
})
export type ScanCoverage = z.infer<typeof scanCoverageSchema>

export interface ScanReportFinding {
  readonly findingId: number
  readonly occurrenceId: number
  readonly ruleId: string
  readonly fingerprint: string
  readonly state: string
  readonly title: string
  readonly summary: string
  readonly severity: string
  readonly confidence: string
  readonly priority: string | null
  readonly locations: readonly {
    readonly path: string
    readonly startLine?: number
    readonly endLine?: number
    readonly symbol?: string
  }[]
  readonly remediation: string
}

/** Persisted, portable scan report. The UI and JSON artifact use this shape. */
export interface ScanReport {
  readonly documentType: 'codetend.scan-report'
  readonly schemaVersion: '1'
  readonly generatedAt: string
  readonly scan: {
    readonly id: number
    readonly repositoryId: number
    readonly repositoryName: string
    readonly repositoryUrl: string
    readonly revision: string
    readonly target: ScanTarget
    readonly mode: ScanMode
    readonly maxInputTokens: number
    readonly model: string | null
    readonly status: string
  }
  readonly summary: {
    readonly overallScore: number | null
    readonly grade: string | null
    readonly findingCount: number
    readonly findingCounts: {
      readonly new: number
      readonly active: number
      readonly improved: number
      readonly resolved: number
      readonly regressed: number
    } | null
  }
  readonly coverage: ScanCoverage
  readonly investigation: InvestigationReport
  readonly findings: readonly ScanReportFinding[]
}

export interface ScanManifest {
  readonly schemaVersion: '2'
  readonly scanId: number
  readonly repositoryId: number
  readonly repositoryUrl: string
  readonly revision: string
  readonly target: ScanTarget
  readonly mode: ScanMode
  readonly maxInputTokens: number
  readonly model: string | null
  readonly scannerVersions: Record<string, string>
  readonly artifactHashes: Record<string, string>
  readonly createdAt: string
}

export const DEFAULT_SCAN_TARGET: ScanTarget = { kind: 'repository' }

export function targetIncludesPath(target: ScanTarget, path: string): boolean {
  if (target.kind === 'repository' || target.kind === 'diff') return true
  return target.paths.some(
    (scope) =>
      path === scope ||
      path.startsWith(`${scope.replace(/\/$/, '')}/`) ||
      scope.startsWith(`${path.replace(/\/$/, '')}/`),
  )
}

export function investigationAllowsResolution(input: {
  readonly target?: ScanTarget
  readonly findingPaths: readonly string[]
  readonly findingSubject?: InvestigationSubject | null
  readonly explicitVerdict: boolean
}): boolean {
  if (!input.explicitVerdict) return false
  const target = input.target
  if (target?.kind === 'paths' && input.findingPaths.length === 0) {
    const subject = input.findingSubject
    if (
      !subject ||
      subject.kind === 'repository' ||
      subject.kind === 'dependency'
    )
      return false
    const subjectPaths =
      subject.kind === 'module' ? subject.paths : [subject.path]
    if (!subjectPaths.some((path) => targetIncludesPath(target, path)))
      return false
  }
  if (
    target &&
    input.findingPaths.some((path) => !targetIncludesPath(target, path))
  ) {
    return false
  }
  return true
}
