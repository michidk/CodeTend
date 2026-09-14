import { z } from 'zod'

export const SCAN_MODES = ['standard', 'deep'] as const
export type ScanMode = (typeof SCAN_MODES)[number]

export const DEFAULT_SCAN_MAX_FILES = 300
export const MAX_SCAN_MAX_FILES = 10_000
export const SCAN_FILE_BUDGET_PRESETS = [100, 300, 1_000] as const
export const DEFAULT_SCAN_FILE_GLOB =
  '**/*.{c,cc,cpp,cxx,cs,css,dart,ex,exs,fs,fsx,go,gql,graphql,groovy,h,hh,hpp,hxx,hs,htm,html,java,js,jsx,kt,kts,less,lua,m,mjs,mm,php,pl,pm,proto,py,pyi,r,rb,rs,sass,scala,scss,sh,sol,sql,svelte,swift,tf,ts,tsx,vue,zig}'
export const MAX_SCAN_FILE_GLOB_LENGTH = 1_000

export const scanFileGlobSchema = z
  .string()
  .trim()
  .min(1, 'Enter a file glob.')
  .max(MAX_SCAN_FILE_GLOB_LENGTH, 'The file glob is too long.')

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

export const scanCoverageSchema = z.object({
  completeness: z.enum(['complete', 'partial', 'unknown']),
  reviewed: z.array(z.string()),
  deferred: z.array(z.object({ path: z.string(), reason: z.string() })),
  excluded: z.array(z.object({ path: z.string(), reason: z.string() })),
  openQuestions: z.array(z.string()),
})
export type ScanCoverage = z.infer<typeof scanCoverageSchema>

export interface ScanManifest {
  readonly schemaVersion: '1'
  readonly scanId: number
  readonly repositoryId: number
  readonly repositoryUrl: string
  readonly revision: string
  readonly target: ScanTarget
  readonly mode: ScanMode
  readonly maxFiles: number
  readonly fileGlob: string
  readonly reviewedFileCount: number | null
  readonly targetFileCount: number | null
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

export function coverageAllowsResolution(input: {
  readonly authoritative?: boolean
  readonly coverage?: ScanCoverage
  readonly target?: ScanTarget
  readonly targetFiles?: readonly string[]
  readonly findingPaths: readonly string[]
}): boolean {
  if (input.authoritative) return true
  if (input.coverage?.completeness !== 'complete') return false
  if (input.findingPaths.length === 0) return false
  const target = input.target
  if (
    target &&
    input.findingPaths.some((path) => !targetIncludesPath(target, path))
  ) {
    return false
  }
  if (
    input.targetFiles &&
    input.findingPaths.some((path) => !input.targetFiles?.includes(path))
  ) {
    return false
  }
  return input.findingPaths.every(
    (path) =>
      !input.coverage?.deferred.some(
        (entry) =>
          entry.path === path ||
          path.startsWith(`${entry.path.replace(/\/$/, '')}/`),
      ),
  )
}
