import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { ArrowLeft, Download, Square } from 'lucide-react'
import { useEffect } from 'react'
import { toast } from 'sonner'
import { EntityNotFound } from '@/components/entity-not-found'
import { FindingCard } from '@/components/health/finding-card'
import {
  formatScore,
  GradeBadge,
  scoreTextClass,
} from '@/components/health/grade-badge'
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getErrorMessage } from '@/lib/error-message'
import {
  formatDateTime,
  formatDuration,
  formatTokens,
  shortSha,
} from '@/lib/format'
import { parseIdParam } from '@/lib/route-params'
import { enabledScanners } from '@/lib/scanners'
import type { ScanTarget } from '@/lib/security-scans'
import { cancelScan } from '@/lib/server/repositories'
import { getScanDetail } from '@/lib/server/repository-detail'

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

  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => void router.invalidate(), 4_000)
    return () => window.clearInterval(timer)
  }, [active, router])

  if (!scan)
    return (
      <EntityNotFound entity="Scan" backTo="/" backLabel="Go to dashboard" />
    )

  const usageTracked = scan.modelCalls != null
  const cachedTokens =
    scan.cacheReadTokens == null
      ? null
      : scan.cacheReadTokens + (scan.cacheWriteTokens ?? 0)

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
            <span className="capitalize">{scan.mode}</span> ·{' '}
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

      <section aria-labelledby="coverage-heading" className="space-y-3">
        <SectionHeading id="coverage-heading" color="bg-candy-mint">
          Security review coverage
        </SectionHeading>
        <Card>
          <CardContent className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="capitalize">
                {scan.coverage?.completeness ?? 'unknown'} coverage
              </Badge>
              <span className="text-muted-foreground">
                {scan.coverage?.reviewed.length ?? 0} reviewed surfaces ·{' '}
                {scan.coverage?.deferred.length ?? 0} deferred ·{' '}
                {scan.coverage?.excluded.length ?? 0} excluded
              </span>
            </div>
            {scan.coverage?.reviewed.length ? (
              <StringList title="Reviewed" values={scan.coverage.reviewed} />
            ) : null}
            {scan.coverage?.deferred.length ? (
              <StringList
                title="Deferred"
                values={scan.coverage.deferred.map(
                  (entry) => `${entry.path}: ${entry.reason}`,
                )}
              />
            ) : null}
            {scan.coverage?.openQuestions.length ? (
              <StringList
                title="Open questions"
                values={scan.coverage.openQuestions}
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
            {enabledScanners.map((scanner) => {
              const run = scan.scannerRuns.find(
                (entry) => entry.scannerId === scanner.id,
              )
              return (
                <TableRow key={scanner.id}>
                  <TableCell className="font-semibold">
                    <Link
                      to="/repositories/$repositoryId/scanners/$scannerId"
                      params={{
                        repositoryId: String(scan.repositoryId),
                        scannerId: scanner.id,
                      }}
                      className="text-link hover:underline"
                    >
                      {scanner.name}
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
          <div className="space-y-2">
            {scan.occurrences.map((occurrence) => (
              <FindingCard
                key={occurrence.id}
                finding={{
                  ...occurrence.finding,
                  state: occurrence.state,
                  severity: occurrence.severity,
                  classification: occurrence.classification,
                  securityContext: occurrence.securityContext,
                  rootCause: occurrence.rootCause,
                  codeEvidence: occurrence.codeEvidence,
                  attackPath: occurrence.attackPath,
                  validationPlan: occurrence.validationPlan,
                  vulnerability: occurrence.vulnerability,
                  priority: occurrence.priority,
                  priorityScore: occurrence.priorityScore,
                  priorityReasons: occurrence.priorityReasons,
                  validations: occurrence.validations,
                }}
                showScanner
              />
            ))}
          </div>
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
