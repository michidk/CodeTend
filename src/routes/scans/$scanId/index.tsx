import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import {
  ArrowLeft,
  ChevronDown,
  Download,
  FileCode2,
  Square,
} from 'lucide-react'
import { toast } from 'sonner'
import { EntityNotFound } from '@/components/entity-not-found'
import {
  formatScore,
  GradeBadge,
  scoreTextClass,
} from '@/components/health/grade-badge'
import { ScanProgress } from '@/components/health/scan-progress'
import { ScanStatusBadge } from '@/components/health/scan-status'
import {
  CostCell,
  StatTile,
  TokensCell,
  totalUsageTokens,
} from '@/components/health/usage-stats'
import { Markdown } from '@/components/markdown'
import { Page, PageHeader, SectionHeading } from '@/components/page-layout'
import { RouteError } from '@/components/route-error'
import { RoutePending } from '@/components/route-pending'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useActivityRefresh } from '@/hooks/use-activity-refresh'
import { getErrorMessage } from '@/lib/error-message'
import {
  formatDateTime,
  formatDuration,
  formatTokens,
  shortSha,
} from '@/lib/format'
import { parseIdParam } from '@/lib/route-params'
import { getScanner } from '@/lib/scanners'
import type {
  InvestigationEvidence,
  InvestigationSubject,
  ScanCoverage,
  ScanCoverageEntry,
  ScanTarget,
} from '@/lib/security-scans'
import { cancelScan } from '@/lib/server/repositories'
import { getScanDetail } from '@/lib/server/repository-detail'
import { FindingGroups } from './-components/finding-groups'

export const Route = createFileRoute('/scans/$scanId/')({
  loader: ({ params }) => getScanDetail({ data: parseIdParam(params.scanId) }),
  staleTime: 5_000,
  component: ScanPage,
  pendingComponent: RoutePending,
  errorComponent: ({ error }) => (
    <RouteError error={error} backTo="/" backLabel="Go to dashboard" />
  ),
})

function ScanPage() {
  const scan = Route.useLoaderData()
  const router = useRouter()
  const active = scan?.status === 'queued' || scan?.status === 'running'
  const generating =
    scan?.occurrences.some(
      (occurrence) =>
        occurrence.finding.patches[0]?.status === 'queued' ||
        occurrence.finding.patches[0]?.status === 'generating',
    ) ?? false
  useActivityRefresh(
    { kind: 'scan', scanId: scan?.id ?? 0 },
    scan !== null && (active || generating),
  )

  if (!scan)
    return (
      <EntityNotFound entity="Scan" backTo="/" backLabel="Go to dashboard" />
    )

  const usageTracked = scan.modelCalls != null
  const cachedTokens =
    scan.cacheReadTokens == null
      ? null
      : scan.cacheReadTokens + (scan.cacheWriteTokens ?? 0)
  const scannerNames = Object.fromEntries(
    scan.scannerRuns.map((run) => [
      run.scannerId,
      run.scannerDefinition?.shortName ??
        getScanner(run.scannerId)?.shortName ??
        run.scannerId,
    ]),
  )

  const stop = async () => {
    try {
      await cancelScan({ data: scan.id })
      toast.success('Cancellation requested')
      await router.invalidate()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not cancel the scan'))
    }
  }

  return (
    <Page>
      <PageHeader
        eyebrow={
          <Link
            to="/repositories/$repositoryId"
            params={{ repositoryId: String(scan.repositoryId) }}
            className="inline-flex items-center gap-1 text-link hover:underline"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            {scan.repository.name}
          </Link>
        }
        title={`Scan #${scan.id}`}
        description={
          <>
            <ScanStatusBadge status={scan.status} phase={scan.phase} /> ·{' '}
            {scan.trigger} · branch <code>{scan.branch}</code> · commit{' '}
            <code>{shortSha(scan.commitSha)}</code>
            {scan.fileCount ? ` · ${scan.fileCount} files` : ''} ·{' '}
            {formatDuration(scan.startedAt, scan.finishedAt)}
            {scan.gitnexusUsed ? ' · GitNexus' : ''}
            {scan.knowledgeRefreshed ? ' · knowledge refreshed' : ''}
            {' · '}
            {formatTokens(scan.maxInputTokens)} input-token budget ·{' '}
            {describeTarget(scan.target)}
          </>
        }
        size="compact"
        leading={<GradeBadge grade={scan.grade} size="lg" />}
        actions={
          active ? (
            <Button
              variant="outline"
              onClick={() => void stop()}
              disabled={scan.cancellationRequestedAt !== null}
            >
              <Square className="size-4" aria-hidden="true" />
              {scan.cancellationRequestedAt ? 'Cancelling…' : 'Stop scan'}
            </Button>
          ) : undefined
        }
      />

      {active && scan.progress ? (
        <ScanProgress progress={scan.progress} />
      ) : null}

      {scan.error ? (
        <Card className="border-destructive/40">
          <CardContent className="text-sm">
            <p className="font-semibold text-destructive-text">Scan error</p>
            <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
              {scan.error}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {scan.report ? (
        <section aria-labelledby="report-heading" className="space-y-3">
          <SectionHeading id="report-heading" color="bg-candy-sun">
            Structured report
          </SectionHeading>
          <Card>
            <CardContent className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="outline">
                JSON · schema v{scan.report.schemaVersion}
              </Badge>
              <span className="text-muted-foreground">
                {scan.report.summary.findingCount} findings · grade{' '}
                {scan.report.summary.grade ?? '–'} · score{' '}
                {formatScore(scan.report.summary.overallScore)} ·{' '}
                {scan.report.investigation.evidence.length} evidence records
              </span>
            </CardContent>
          </Card>
        </section>
      ) : null}

      <CoverageSection coverage={scan.coverage ?? scan.report?.coverage} />

      <section aria-labelledby="investigation-heading" className="space-y-3">
        <SectionHeading id="investigation-heading" color="bg-candy-mint">
          Investigation
        </SectionHeading>
        <Card>
          <CardContent className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="capitalize">
                {scan.investigation?.confidence ?? 'unknown'} confidence
              </Badge>
              <span className="text-muted-foreground">
                {scan.investigation?.focusAreas.length ?? 0} focus areas ·{' '}
                {scan.investigation?.evidence.length ?? 0} evidence records
              </span>
            </div>
            {scan.investigation?.strategy ? (
              <p className="text-muted-foreground">
                {scan.investigation.strategy}
              </p>
            ) : null}
            {scan.scannerRuns.some((run) => run.investigation) ? (
              <StringList
                title="Scanner strategies"
                values={scan.scannerRuns.flatMap((run) =>
                  run.investigation
                    ? [
                        `${scannerNames[run.scannerId]}: ${run.investigation.strategy}`,
                      ]
                    : [],
                )}
              />
            ) : null}
            {scan.investigation?.blindSpots.length ? (
              <StringList
                title="Known blind spots"
                values={scan.investigation.blindSpots}
              />
            ) : null}
            {scan.investigation?.focusAreas.length ? (
              <DetailList
                title="Focus areas"
                count={scan.investigation.focusAreas.length}
                values={scan.investigation.focusAreas.map(formatSubject)}
              />
            ) : null}
            {scan.investigation?.evidence.length ? (
              <DetailList
                title="Evidence"
                count={scan.investigation.evidence.length}
                values={scan.investigation.evidence.map(formatEvidence)}
              />
            ) : null}
            {scan.artifacts.length > 0 ? (
              <div className="flex flex-wrap gap-2 pt-1">
                {scan.artifacts.map((artifact) => (
                  <Button
                    key={artifact.kind}
                    variant="outline"
                    size="sm"
                    asChild
                  >
                    <a
                      href={`/api/scans/${scan.id}/artifacts/${artifact.kind}`}
                      download
                    >
                      <Download className="size-3.5" aria-hidden="true" />
                      {artifact.kind === 'sarif'
                        ? 'SARIF'
                        : artifact.kind.replace(/^./, (value) =>
                            value.toUpperCase(),
                          )}
                    </a>
                  </Button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Content-hashed artifacts appear when the scan finishes.
              </p>
            )}
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="usage-heading" className="space-y-3">
        <SectionHeading id="usage-heading" color="bg-candy-sun">
          Model usage
        </SectionHeading>
        {usageTracked ? (
          <>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <StatTile
                label="Model calls"
                value={formatTokens(scan.modelCalls)}
              />
              <StatTile
                label="Tokens"
                value={formatTokens(totalUsageTokens(scan))}
                hint="input, output and cache activity"
              />
              <StatTile
                label="Cached tokens"
                value={formatTokens(cachedTokens)}
              />
              <StatTile
                label="Estimated cost"
                value={
                  <CostCell
                    value={scan.estimatedCostUsd}
                    tracked={usageTracked}
                  />
                }
                className="bg-candy-sun"
              />
            </div>
            <p className="text-xs font-semibold text-muted-foreground">
              Model <code>{scan.model ?? 'unknown'}</code>. Hover token totals
              below for their input, output and cache breakdown.
            </p>
          </>
        ) : (
          <Card>
            <CardContent className="text-sm font-semibold text-muted-foreground">
              {active
                ? 'Usage will appear after this scan finishes.'
                : 'Usage was not recorded for this scan.'}
            </CardContent>
          </Card>
        )}
      </section>

      <Card className="overflow-x-auto">
        <CardHeader>
          <CardTitle>
            Scanner runs · overall{' '}
            <span className={scoreTextClass(scan.overallScore)}>
              {formatScore(scan.overallScore)}
            </span>
          </CardTitle>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Scanner</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Score</TableHead>
              <TableHead className="text-right">Tokens</TableHead>
              <TableHead className="text-right">Cost</TableHead>
              <TableHead className="text-right">Duration</TableHead>
              <TableHead>Summary</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {scan.scannerRuns.map((run) => {
              const scanner = run.scannerDefinition ?? getScanner(run.scannerId)
              return (
                <TableRow key={run.scannerId}>
                  <TableCell className="font-semibold">
                    <Link
                      to="/repositories/$repositoryId/scanners/$scannerId"
                      params={{
                        repositoryId: String(scan.repositoryId),
                        scannerId: run.scannerId,
                      }}
                      className="text-link hover:underline"
                    >
                      {scanner?.name ?? run.scannerId}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        run?.status === 'failed' ? 'destructive' : 'secondary'
                      }
                      className="capitalize"
                    >
                      {run?.status ?? 'pending'}
                    </Badge>
                  </TableCell>
                  <TableCell
                    className={`text-right font-semibold tabular-nums ${scoreTextClass(run?.score)}`}
                  >
                    {formatScore(run?.score)}
                  </TableCell>
                  <TableCell className="text-right">
                    {run ? <TokensCell usage={run} /> : '–'}
                  </TableCell>
                  <TableCell className="text-right">
                    <CostCell
                      value={run?.estimatedCostUsd ?? null}
                      tracked={run?.modelCalls != null}
                    />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatDuration(run?.startedAt, run?.finishedAt)}
                  </TableCell>
                  <TableCell className="max-w-xl text-xs text-muted-foreground">
                    {run?.status === 'failed' ? (
                      run.error
                    ) : run?.summary ? (
                      <Markdown compact>{run.summary}</Markdown>
                    ) : null}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Card>

      <section
        aria-labelledby="occurrences-heading"
        className="space-y-3 sm:space-y-4"
      >
        <SectionHeading id="occurrences-heading" color="bg-candy-pink">
          Findings observed in this scan{' '}
          <Badge variant="outline" className="ml-1 align-middle">
            {scan.occurrences.length}
          </Badge>
        </SectionHeading>
        {scan.occurrences.length === 0 ? (
          <Card>
            <CardContent className="text-sm text-muted-foreground">
              {active
                ? 'Findings appear once the scanners finish.'
                : 'No findings were recorded for this scan.'}
            </CardContent>
          </Card>
        ) : (
          <FindingGroups
            occurrences={scan.occurrences}
            scannerNames={scannerNames}
          />
        )}
      </section>

      <p className="text-xs text-muted-foreground">
        Created {formatDateTime(scan.createdAt)}
        {scan.eveSessionId ? ` · Eve session ${scan.eveSessionId}` : ''}
      </p>
    </Page>
  )
}

function describeTarget(target: ScanTarget): string {
  if (target.kind === 'repository') return 'entire repository'
  if (target.kind === 'paths') return `${target.paths.length} selected path(s)`
  return `diff ${shortSha(target.base)}…${shortSha(target.head)}`
}

function CoverageSection({
  coverage,
}: {
  readonly coverage?: ScanCoverage | null
}) {
  const reviewed = normalizeReviewed(coverage?.reviewed)
  const deferred = coverage?.deferred ?? []
  const excluded = coverage?.excluded ?? []
  const hasDetails =
    reviewed.length > 0 ||
    deferred.length > 0 ||
    excluded.length > 0 ||
    Boolean(coverage?.openQuestions.length)

  return (
    <section aria-labelledby="coverage-heading" className="space-y-3">
      <SectionHeading id="coverage-heading" color="bg-candy-mint">
        Security review coverage
      </SectionHeading>
      <Card>
        <CardContent className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="capitalize">
              {coverage?.completeness ?? 'unknown'} coverage
            </Badge>
            <span className="text-muted-foreground">
              {reviewed.length} reviewed files · {deferred.length} deferred ·{' '}
              {excluded.length} excluded
            </span>
          </div>
          {reviewed.length > 0 ? (
            <CoverageFileList title="Reviewed" entries={reviewed} />
          ) : null}
          {deferred.length > 0 ? (
            <CoverageFileList
              title="Deferred"
              entries={deferred.map((entry) => ({
                path: entry.path,
                summary: entry.reason,
              }))}
            />
          ) : null}
          {excluded.length > 0 ? (
            <CoverageFileList
              title="Excluded"
              entries={excluded.map((entry) => ({
                path: entry.path,
                summary: entry.reason,
              }))}
            />
          ) : null}
          {coverage?.openQuestions.length ? (
            <DetailList
              title="Open questions"
              count={coverage.openQuestions.length}
              values={coverage.openQuestions}
            />
          ) : null}
          {!hasDetails ? (
            <p className="text-xs text-muted-foreground">
              Structured coverage will appear when this scan finishes.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </section>
  )
}

function CoverageFileList({
  title,
  entries,
}: {
  readonly title: string
  readonly entries: readonly ScanCoverageEntry[]
}) {
  return (
    <Collapsible className="group overflow-hidden rounded-lg border">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title} <span className="tabular-nums">({entries.length})</span>
        </span>
        <ChevronDown className="size-4 text-muted-foreground transition-transform group-data-[open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t">
        <ul className="divide-y">
          {entries.map((entry) => (
            <li
              key={JSON.stringify(entry)}
              className="flex items-start gap-2 px-3 py-2.5"
            >
              <FileCode2
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              />
              <div className="min-w-0">
                <code className="break-all text-xs font-semibold text-foreground">
                  {formatFileReference(entry)}
                </code>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {entry.summary}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  )
}

function DetailList({
  title,
  count,
  values,
}: {
  readonly title: string
  readonly count: number
  readonly values: readonly string[]
}) {
  const uniqueValues = [...new Set(values)]
  return (
    <Collapsible className="group overflow-hidden rounded-lg border">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title} <span className="tabular-nums">({count})</span>
        </span>
        <ChevronDown className="size-4 text-muted-foreground transition-transform group-data-[open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t">
        <ul className="list-disc space-y-1 px-8 py-2.5 text-muted-foreground">
          {uniqueValues.map((value) => (
            <li key={value}>{value}</li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  )
}

function normalizeReviewed(
  reviewed: ScanCoverage['reviewed'] | undefined,
): ScanCoverageEntry[] {
  return (reviewed ?? []).map((entry) =>
    typeof entry === 'string'
      ? { path: entry, summary: 'Reviewed during this scan.' }
      : entry,
  )
}

function formatFileReference(entry: ScanCoverageEntry): string {
  if (!entry.startLine) return entry.path
  return `${entry.path}:${entry.startLine}${entry.endLine && entry.endLine !== entry.startLine ? `-${entry.endLine}` : ''}`
}

function formatSubject(subject: InvestigationSubject): string {
  if (subject.kind === 'repository') return subject.aspect
  if (subject.kind === 'module') {
    return `${subject.name}${subject.paths.length ? ` — ${subject.paths.join(', ')}` : ''}`
  }
  if (subject.kind === 'dependency') return `${subject.from} → ${subject.to}`
  if (subject.kind === 'symbol') return `${subject.path} — ${subject.symbol}`
  return subject.path
}

function formatEvidence(evidence: InvestigationEvidence): string {
  if (evidence.kind === 'file') {
    return `${formatFileReference({ ...evidence })} — ${evidence.summary}`
  }
  if (evidence.kind === 'repository-structure') {
    return `${evidence.paths.join(', ')} — ${evidence.summary}`
  }
  if (evidence.kind === 'dependency-edge') {
    return `${evidence.from} → ${evidence.to} — ${evidence.summary}`
  }
  if (evidence.kind === 'command') {
    return `${evidence.command} — ${evidence.summary}`
  }
  return `${evidence.tool} — ${evidence.summary}`
}

function StringList({
  title,
  values,
}: {
  readonly title: string
  readonly values: readonly string[]
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
        {values.map((value) => (
          <li key={value}>{value}</li>
        ))}
      </ul>
    </div>
  )
}
