import { minimatch } from 'minimatch'

export interface SampleCandidate {
  readonly path: string
  readonly size: number
}

export const DEFAULT_SCAN_FILE_GLOB =
  '**/*.{c,cc,cpp,cxx,cs,css,dart,ex,exs,fs,fsx,go,gql,graphql,groovy,h,hh,hpp,hxx,hs,htm,html,java,js,jsx,kt,kts,less,lua,m,mjs,mm,php,pl,pm,proto,py,pyi,r,rb,rs,sass,scala,scss,sh,sol,sql,svelte,swift,tf,ts,tsx,vue,zig}'

const SECURITY_TERMS =
  /(^|[/_.-])(auth|admin|api|crypto|permission|policy|secret|security|session|token|webhook)([/_.-]|$)/i
const ENTRY_POINT_TERMS =
  /(^|[/_.-])(app|bootstrap|controller|handler|index|main|middleware|route|server)([/_.-]|$)/i
const TEST_TERMS = /(^|[/_.-])(spec|test|tests)([/_.-]|$)/i
const LOW_VALUE_TERMS =
  /(^|[/_.-])(coverage|fixture|fixtures|generated|snapshot|snapshots)([/_.-]|$)|\.(lock|map|min\.(css|js))$/i
const BINARY_EXTENSIONS =
  /\.(avif|bmp|eot|gif|ico|jpeg|jpg|mov|mp3|mp4|pdf|png|ttf|webm|webp|woff2?|zip)$/i

/**
 * Applies the configured file glob, then selects a stable, risk-biased sample.
 * Previous-finding locations, entry points and security-sensitive source
 * receive priority, while top-level-area seeds avoid tunnel vision.
 */
export function selectReviewFiles(input: {
  readonly candidates: readonly SampleCandidate[]
  readonly maxFiles: number
  readonly fileGlob: string
  readonly priorityPaths?: readonly string[]
}): string[] {
  const maxFiles = Math.max(1, Math.floor(input.maxFiles))
  const priority = new Set(input.priorityPaths ?? [])
  const ranked = input.candidates
    .filter((candidate) =>
      matchesReviewFileGlob(candidate.path, input.fileGlob),
    )
    .map((candidate) => ({
      ...candidate,
      score: scoreCandidate(candidate, priority),
    }))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))

  if (ranked.length <= maxFiles) return ranked.map((file) => file.path).sort()

  const selected = new Set<string>()
  const bestByArea = new Map<string, (typeof ranked)[number]>()
  for (const file of ranked) {
    const area = file.path.includes('/') ? file.path.split('/')[0] : '(root)'
    if (!bestByArea.has(area) && file.score > 0) bestByArea.set(area, file)
  }
  const areaSeeds = [...bestByArea.values()].sort(
    (a, b) => b.score - a.score || a.path.localeCompare(b.path),
  )
  const areaSeedLimit = Math.min(
    areaSeeds.length,
    Math.max(1, Math.floor(maxFiles / 4)),
  )
  for (const file of areaSeeds.slice(0, areaSeedLimit)) {
    selected.add(file.path)
  }
  for (const file of ranked) {
    if (selected.size >= maxFiles) break
    selected.add(file.path)
  }
  return [...selected].sort()
}

export function matchesReviewFileGlob(path: string, fileGlob: string): boolean {
  return minimatch(path, fileGlob, { dot: true, nocase: true })
}

function scoreCandidate(
  candidate: SampleCandidate,
  priorityPaths: ReadonlySet<string>,
): number {
  const path = candidate.path
  let score = priorityPaths.has(path) ? 2_000 : 0
  if (SECURITY_TERMS.test(path)) score += 300
  if (ENTRY_POINT_TERMS.test(path)) score += 220
  if (TEST_TERMS.test(path)) score += 60
  if (!path.includes('/')) score += 80
  if (LOW_VALUE_TERMS.test(path)) score -= 250
  if (BINARY_EXTENSIONS.test(path)) score -= 800
  if (candidate.size > 1_000_000) score -= 400
  return score
}
