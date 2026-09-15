import cvssCalculator from 'ae-cvss-calculator'
import { z } from 'zod'
import type {
  Confidence,
  CvssMetric,
  EnrichedScannerFinding,
  EpssMetric,
  FindingPriority,
  KevEntry,
  ScannerFinding,
  SecurityContext,
  Severity,
  VulnerabilityMetadata,
} from '@/lib/findings'

const osvEventSchema = z.object({
  introduced: z.string().optional(),
  fixed: z.string().optional(),
  last_affected: z.string().optional(),
  limit: z.string().optional(),
})

const osvAffectedSchema = z.object({
  package: z.object({
    ecosystem: z.string(),
    name: z.string(),
    purl: z.string().optional(),
  }),
  ranges: z
    .array(z.object({ type: z.string(), events: z.array(osvEventSchema) }))
    .optional(),
  database_specific: z
    .object({ cwe_ids: z.array(z.string()).optional() })
    .optional(),
})

const osvVulnerabilitySchema = z.object({
  id: z.string(),
  aliases: z.array(z.string()).optional(),
  summary: z.string().optional(),
  details: z.string().optional(),
  published: z.string().optional(),
  modified: z.string().optional(),
  affected: z.array(osvAffectedSchema).optional(),
  severity: z
    .array(z.object({ type: z.string(), score: z.string() }))
    .optional(),
  database_specific: z
    .object({
      cwe_ids: z.array(z.string()).optional(),
      severity: z.string().optional(),
    })
    .optional(),
})

const osvPackageSchema = z.object({
  package: z.object({
    ecosystem: z.string(),
    name: z.string(),
    version: z.string(),
  }),
  groups: z
    .array(
      z.object({
        ids: z.array(z.string()),
        aliases: z.array(z.string()).optional(),
        max_severity: z.string().optional(),
      }),
    )
    .optional(),
  vulnerabilities: z.array(osvVulnerabilitySchema),
})

const osvReportSchema = z.object({
  results: z
    .array(
      z.object({
        source: z.object({ path: z.string(), type: z.string().optional() }),
        packages: z.array(osvPackageSchema),
      }),
    )
    .nullable()
    .default([])
    .transform((results) => results ?? []),
})

type OsvVulnerability = z.infer<typeof osvVulnerabilitySchema>

export interface OsvDependencyMatch {
  readonly key: string
  readonly ecosystem: string
  readonly packageName: string
  readonly version: string
  readonly manifestPath: string
  readonly ids: readonly string[]
  readonly vulnerabilities: readonly OsvVulnerability[]
  readonly maxSeverity: number | null
}

export interface VulnerabilityIntelligence {
  readonly epssByCve: ReadonlyMap<string, EpssMetric>
  readonly kevByCve: ReadonlyMap<string, KevEntry>
}

export function parseOsvDependencyReport(
  report: unknown,
  workspaceRoot: string,
): OsvDependencyMatch[] {
  const parsed = osvReportSchema.parse(report)
  const matches: OsvDependencyMatch[] = []

  for (const result of parsed.results) {
    const manifestPath = repositoryRelativePath(
      result.source.path,
      workspaceRoot,
    )
    for (const entry of result.packages) {
      const groups =
        entry.groups && entry.groups.length > 0
          ? entry.groups
          : entry.vulnerabilities.map((vulnerability) => ({
              ids: [vulnerability.id],
              aliases: vulnerability.aliases,
              max_severity: undefined,
            }))

      for (const group of groups) {
        const groupIds = uniqueStrings([
          ...(group.ids ?? []),
          ...(group.aliases ?? []),
        ])
        const vulnerabilities = entry.vulnerabilities.filter(
          (vulnerability) => {
            const ids = [vulnerability.id, ...(vulnerability.aliases ?? [])]
            return ids.some((id) => groupIds.includes(id))
          },
        )
        if (vulnerabilities.length === 0) continue

        const ids = uniqueStrings([
          ...groupIds,
          ...vulnerabilities.flatMap((vulnerability) => [
            vulnerability.id,
            ...(vulnerability.aliases ?? []),
          ]),
        ])
        const key = group.ids[0] ?? vulnerabilities[0]?.id
        if (!key) continue
        const numericSeverity = Number.parseFloat(group.max_severity ?? '')
        matches.push({
          key,
          ecosystem: entry.package.ecosystem,
          packageName: entry.package.name,
          version: entry.package.version,
          manifestPath,
          ids,
          vulnerabilities,
          maxSeverity: Number.isFinite(numericSeverity)
            ? numericSeverity
            : null,
        })
      }
    }
  }

  return dedupeMatches(matches)
}

export function cveIdsForMatches(
  matches: readonly OsvDependencyMatch[],
): string[] {
  return uniqueStrings(matches.flatMap((match) => match.ids)).filter((id) =>
    /^CVE-\d{4}-\d{4,}$/i.test(id),
  )
}

export function dependencyFindingsFromMatches(
  matches: readonly OsvDependencyMatch[],
  intelligence: VulnerabilityIntelligence,
  enrichedAt = new Date().toISOString(),
): EnrichedScannerFinding[] {
  const findings: EnrichedScannerFinding[] = matches.map((match) => {
    const cves = match.ids.filter((id) => /^CVE-/i.test(id))
    const epss = cves
      .map((cve) => intelligence.epssByCve.get(cve.toUpperCase()))
      .filter((metric): metric is EpssMetric => metric !== undefined)
    const kev = cves
      .map((cve) => intelligence.kevByCve.get(cve.toUpperCase()))
      .filter((entry): entry is KevEntry => entry !== undefined)
    const cvss = cvssMetrics(match.vulnerabilities)
    const fallbackSeverity = databaseSeverity(match.vulnerabilities)
    const highestCvss = Math.max(
      match.maxSeverity ?? 0,
      ...cvss.map((metric) => metric.score),
    )
    const severity =
      highestCvss > 0
        ? severityForCvssScore(highestCvss)
        : (fallbackSeverity ?? 'medium')
    const fixedVersions = uniqueStrings(
      match.vulnerabilities.flatMap((vulnerability) =>
        (vulnerability.affected ?? []).flatMap((affected) =>
          (affected.ranges ?? []).flatMap((range) =>
            range.events.flatMap((event) => (event.fixed ? [event.fixed] : [])),
          ),
        ),
      ),
    )
    const purl = match.vulnerabilities
      .flatMap((vulnerability) => vulnerability.affected ?? [])
      .find(
        (affected) =>
          affected.package.ecosystem === match.ecosystem &&
          affected.package.name === match.packageName,
      )?.package.purl
    const priority = deriveDependencyPriority({
      cvssScore: highestCvss > 0 ? highestCvss : null,
      severity,
      epss,
      kev,
      fixedVersions,
    })
    const primary = preferredAdvisoryId(match.ids, match.key)
    const summary =
      match.vulnerabilities.find((vulnerability) => vulnerability.summary)
        ?.summary ?? `OSV reports ${primary} for this package version.`
    const cwes = uniqueStrings(
      match.vulnerabilities.flatMap((vulnerability) => [
        ...(vulnerability.database_specific?.cwe_ids ?? []),
        ...(vulnerability.affected ?? []).flatMap(
          (affected) => affected.database_specific?.cwe_ids ?? [],
        ),
      ]),
    ).filter((id) => /^CWE-[1-9][0-9]*$/.test(id))
    const vulnerability: VulnerabilityMetadata = {
      package: {
        ecosystem: match.ecosystem,
        name: match.packageName,
        version: match.version,
        purl: purl ?? null,
        cpe: null,
        manifestPath: match.manifestPath,
      },
      advisories: match.ids.map((id) => ({
        id,
        url: `https://osv.dev/vulnerability/${encodeURIComponent(id)}`,
      })),
      match: {
        method: purl ? 'osv-lockfile-purl' : 'osv-lockfile-package',
        confidence: 'high',
        evidence: [
          `${match.manifestPath} resolves ${match.ecosystem}/${match.packageName}@${match.version}`,
          purl
            ? `OSV matched ${purl}`
            : 'OSV matched the exact ecosystem, package and version',
        ],
      },
      cvss,
      epss,
      kev,
      fixedVersions,
      publishedAt: earliestDate(
        match.vulnerabilities.map((entry) => entry.published),
      ),
      modifiedAt: latestDate(
        match.vulnerabilities.map((entry) => entry.modified),
      ),
      enrichedAt,
    }

    return {
      fingerprint: vulnerabilityFingerprint(match),
      title: `${primary} affects ${match.packageName} ${match.version}`,
      severity,
      confidence: 'high',
      description: `${summary} The installed version was matched from ${match.manifestPath} using exact ${purl ? 'purl' : 'ecosystem, package and version'} evidence.`,
      whyItMatters: dependencyImpactText({ epss, kev, cvss }),
      recommendation:
        fixedVersions.length > 0
          ? `Upgrade ${match.packageName} to ${fixedVersions[0]} or a later compatible release, regenerate ${match.manifestPath} with the repository package manager, and verify the affected behavior.`
          : `Review the ${primary} advisory and replace, remove, or otherwise mitigate ${match.packageName}; OSV does not currently identify a fixed version.`,
      effort: 'small',
      subject: { kind: 'file' as const, path: match.manifestPath },
      evidence: [
        {
          kind: 'file' as const,
          path: match.manifestPath,
          summary: `Lockfile resolves ${match.packageName}@${match.version}; OSV matched the exact package version.`,
        },
      ],
      locations: [{ path: match.manifestPath }],
      classification: { cwes, owasp: [] },
      vulnerability,
      priority: priority.priority,
      priorityScore: priority.score,
      priorityReasons: priority.reasons,
    }
  })
  return mergeDependencyFindings(findings)
}

export function enrichSourceSecurityFinding(
  finding: ScannerFinding,
): EnrichedScannerFinding {
  const priority = deriveSourcePriority({
    severity: finding.severity,
    confidence: finding.confidence,
    context: finding.securityContext,
  })
  return {
    ...finding,
    priority: priority.priority,
    priorityScore: priority.score,
    priorityReasons: priority.reasons,
  }
}

export function scoreCvssVector(vector: string): CvssMetric | null {
  try {
    const version: CvssMetric['version'] | null = vector.startsWith('CVSS:4.0/')
      ? '4.0'
      : vector.startsWith('CVSS:3.1/')
        ? '3.1'
        : vector.startsWith('CVSS:3.0/')
          ? '3.0'
          : vector.startsWith('CVSS:2.0/') || /^(AV|AC|Au):/.test(vector)
            ? '2.0'
            : null
    if (!version) return null
    const parsed = cvssCalculator.fromVector(vector)
    if (!parsed) return null
    const score = parsed.calculateScores().overall as number
    if (!Number.isFinite(score)) return null
    return cvssMetric(version, vector, score)
  } catch {
    return null
  }
}

export function severityForCvssScore(score: number): Severity {
  if (score >= 9) return 'critical'
  if (score >= 7) return 'high'
  if (score >= 4) return 'medium'
  return 'low'
}

export function deriveDependencyPriority(input: {
  readonly cvssScore: number | null
  readonly severity: Severity
  readonly epss: readonly EpssMetric[]
  readonly kev: readonly KevEntry[]
  readonly fixedVersions: readonly string[]
}): { priority: FindingPriority; score: number; reasons: string[] } {
  const reasons: string[] = []
  let score =
    input.cvssScore === null
      ? { critical: 75, high: 60, medium: 40, low: 20 }[input.severity]
      : input.cvssScore * 7.5
  if (input.cvssScore !== null) {
    reasons.push(`CVSS base score ${input.cvssScore.toFixed(1)}`)
  } else {
    reasons.push(`OSV severity ${input.severity}`)
  }

  const maxEpss = Math.max(0, ...input.epss.map((entry) => entry.probability))
  if (maxEpss >= 0.5) score += 25
  else if (maxEpss >= 0.1) score += 20
  else if (maxEpss >= 0.01) score += 12
  else if (maxEpss >= 0.001) score += 5
  if (input.epss.length > 0) {
    reasons.push(`EPSS ${(maxEpss * 100).toFixed(2)}%`)
  }

  if (input.fixedVersions.length > 0) {
    score += 3
    reasons.push(`Fix available in ${input.fixedVersions[0]}`)
  }
  if (input.kev.length > 0) {
    score = Math.max(score + 20, 95)
    reasons.push('CISA Known Exploited Vulnerability')
  }

  return priorityResult(score, reasons)
}

export function deriveSourcePriority(input: {
  readonly severity: Severity
  readonly confidence: Confidence
  readonly context?: SecurityContext
}): { priority: FindingPriority; score: number; reasons: string[] } {
  const reasons = [`Repository severity ${input.severity}`]
  let score = { critical: 82, high: 65, medium: 40, low: 20 }[input.severity]
  const context = input.context

  if (context?.reachability === 'confirmed') {
    score += 8
    reasons.push('Reachable path confirmed')
  } else if (context?.reachability === 'likely') {
    score += 4
    reasons.push('Reachable path likely')
  } else if (context?.reachability === 'not-reachable') {
    score -= 15
    reasons.push('No reachable path found')
  }
  if (context?.exposure === 'internet') {
    score += 10
    reasons.push('Internet exposed')
  } else if (context?.exposure === 'internal') {
    score += 4
    reasons.push('Internally exposed')
  } else if (context?.exposure === 'local') {
    score -= 4
    reasons.push('Local exposure only')
  }
  if (context?.dataSensitivity === 'high') {
    score += 5
    reasons.push('High-sensitivity data or authority')
  }
  if (input.confidence === 'low') score -= 10
  else if (input.confidence === 'medium') score -= 4

  return priorityResult(score, reasons)
}

function cvssMetrics(
  vulnerabilities: readonly OsvVulnerability[],
): CvssMetric[] {
  const byVector = new Map<string, CvssMetric>()
  for (const severity of vulnerabilities.flatMap(
    (vulnerability) => vulnerability.severity ?? [],
  )) {
    const metric = scoreCvssVector(severity.score)
    if (metric) byVector.set(metric.vector, metric)
  }
  return [...byVector.values()].sort((a, b) => b.score - a.score)
}

function cvssMetric(
  version: CvssMetric['version'],
  vector: string,
  score: number,
): CvssMetric {
  return {
    version,
    vector,
    score,
    severity: severityForCvssScore(score),
    source: 'OSV',
  }
}

function databaseSeverity(
  vulnerabilities: readonly OsvVulnerability[],
): Severity | null {
  const values = vulnerabilities
    .map((vulnerability) =>
      vulnerability.database_specific?.severity?.toLowerCase(),
    )
    .filter((value): value is string => value !== undefined)
  if (values.includes('critical')) return 'critical'
  if (values.includes('high')) return 'high'
  if (values.includes('moderate') || values.includes('medium')) return 'medium'
  if (values.includes('low')) return 'low'
  return null
}

function preferredAdvisoryId(ids: readonly string[], fallback: string): string {
  return (
    ids.find((id) => /^CVE-/i.test(id)) ??
    ids.find((id) => /^GHSA-/i.test(id)) ??
    fallback
  )
}

function vulnerabilityFingerprint(match: OsvDependencyMatch): string {
  return `dependency-${match.key}-${match.ecosystem}-${match.packageName}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120)
}

function mergeDependencyFindings(
  findings: readonly EnrichedScannerFinding[],
): EnrichedScannerFinding[] {
  const merged = new Map<string, EnrichedScannerFinding>()
  for (const finding of findings) {
    const current = merged.get(finding.fingerprint)
    if (!current?.vulnerability || !finding.vulnerability) {
      merged.set(finding.fingerprint, finding)
      continue
    }
    const locations = [...current.locations]
    for (const location of finding.locations) {
      if (!locations.some((entry) => entry.path === location.path)) {
        locations.push(location)
      }
    }
    merged.set(finding.fingerprint, {
      ...current,
      locations,
      classification: {
        cwes: uniqueStrings([
          ...(current.classification?.cwes ?? []),
          ...(finding.classification?.cwes ?? []),
        ]),
        owasp: uniqueStrings([
          ...(current.classification?.owasp ?? []),
          ...(finding.classification?.owasp ?? []),
        ]),
      },
      vulnerability: {
        ...current.vulnerability,
        advisories: uniqueBy(
          [
            ...current.vulnerability.advisories,
            ...finding.vulnerability.advisories,
          ],
          (entry) => entry.id,
        ),
        cvss: uniqueBy(
          [...current.vulnerability.cvss, ...finding.vulnerability.cvss],
          (entry) => entry.vector,
        ).sort((a, b) => b.score - a.score),
        epss: uniqueBy(
          [...current.vulnerability.epss, ...finding.vulnerability.epss],
          (entry) => entry.cve,
        ),
        kev: uniqueBy(
          [...current.vulnerability.kev, ...finding.vulnerability.kev],
          (entry) => entry.cve,
        ),
        fixedVersions: uniqueStrings([
          ...current.vulnerability.fixedVersions,
          ...finding.vulnerability.fixedVersions,
        ]),
        match: {
          ...current.vulnerability.match,
          evidence: uniqueStrings([
            ...current.vulnerability.match.evidence,
            ...finding.vulnerability.match.evidence,
          ]),
        },
      },
    })
  }
  return [...merged.values()]
}

function dependencyImpactText(input: {
  readonly epss: readonly EpssMetric[]
  readonly kev: readonly KevEntry[]
  readonly cvss: readonly CvssMetric[]
}): string {
  if (input.kev.length > 0) {
    return 'CISA records this vulnerability as exploited in the wild, so the affected package should be treated as an active remediation priority.'
  }
  const maxEpss = Math.max(0, ...input.epss.map((entry) => entry.probability))
  if (input.epss.length > 0) {
    return `FIRST estimates a ${(maxEpss * 100).toFixed(2)}% probability of exploitation in the next 30 days. Repository reachability is not yet known, so this priority combines that threat signal with the published severity.`
  }
  if (input.cvss.length > 0) {
    return 'The installed version matches a published vulnerability. No EPSS or CISA KEV signal was available, and repository reachability is not yet known.'
  }
  return 'The installed version matches a published OSV advisory. No standardized CVSS, EPSS, or CISA KEV signal was available, so applicability should be reviewed directly.'
}

function priorityResult(
  rawScore: number,
  reasons: string[],
): { priority: FindingPriority; score: number; reasons: string[] } {
  const score = Math.max(0, Math.min(100, Math.round(rawScore)))
  const priority: FindingPriority =
    score >= 85
      ? 'critical'
      : score >= 60
        ? 'high'
        : score >= 35
          ? 'medium'
          : 'low'
  return { priority, score, reasons }
}

function repositoryRelativePath(path: string, workspaceRoot: string): string {
  const normalizedPath = path.replaceAll('\\', '/')
  const normalizedRoot = workspaceRoot.replaceAll('\\', '/').replace(/\/$/, '')
  if (normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return normalizedPath.slice(normalizedRoot.length + 1)
  }
  return normalizedPath.split('/').at(-1) ?? normalizedPath
}

function dedupeMatches(
  matches: readonly OsvDependencyMatch[],
): OsvDependencyMatch[] {
  const deduped = new Map<string, OsvDependencyMatch>()
  for (const match of matches) {
    const key = [
      match.ecosystem,
      match.packageName,
      match.version,
      match.key,
      match.manifestPath,
    ].join('\0')
    if (!deduped.has(key)) deduped.set(key, match)
  }
  return [...deduped.values()]
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

function uniqueBy<T>(values: readonly T[], key: (value: T) => string): T[] {
  const result = new Map<string, T>()
  for (const value of values) result.set(key(value), value)
  return [...result.values()]
}

function earliestDate(values: readonly (string | undefined)[]): string | null {
  return (
    values.filter((value): value is string => Boolean(value)).sort()[0] ?? null
  )
}

function latestDate(values: readonly (string | undefined)[]): string | null {
  return (
    values
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null
  )
}
