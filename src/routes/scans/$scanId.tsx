import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { useEffect } from 'react'
import { EntityNotFound } from '@/components/entity-not-found'
import { FindingCard } from '@/components/health/finding-card'
import {
  formatScore,
  GradeBadge,
  scoreTextClass,
} from '@/components/health/grade-badge'
import { ScanStatusBadge } from '@/components/health/scan-status'
import { Markdown } from '@/components/markdown'
import { Page, PageHeader, SectionHeading } from '@/components/page-layout'
import { RouteError } from '@/components/route-error'
import { RoutePending } from '@/components/route-pending'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDateTime, formatDuration, shortSha } from '@/lib/format'
import { parseIdParam } from '@/lib/route-params'
import { enabledScanners } from '@/lib/scanners'
import { getScanDetail } from '@/lib/server/repository-detail'

export const Route = createFileRoute('/scans/$scanId')({
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

  return (
    <Page>
      <PageHeader
        eyebrow={
          <Link
            to="/repositories/$repositoryId"
            params={{ repositoryId: String(scan.repositoryId) }}
            className="inline-flex items-center gap-1 text-ink hover:underline"
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
          </>
        }
        size="compact"
        leading={<GradeBadge grade={scan.grade} size="lg" />}
      />

      {scan.error ? (
        <Card className="bg-candy-pink text-ink">
          <CardContent className="text-sm">
            <p className="font-extrabold">Scan error</p>
            <p className="mt-1 whitespace-pre-wrap font-semibold">
              {scan.error}
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
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
                      className="font-extrabold text-link decoration-[3px] underline-offset-4 hover:underline"
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
                    className={`text-right font-display text-base font-bold tabular-nums ${scoreTextClass(run?.score)}`}
                  >
                    {formatScore(run?.score)}
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
          <Card className="bg-candy-lime text-ink">
            <CardContent className="text-sm font-bold">
              {active
                ? 'Findings appear once the scanners finish.'
                : 'No findings were recorded for this scan.'}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {scan.occurrences.map((occurrence) => (
              <FindingCard
                key={occurrence.id}
                finding={{
                  ...occurrence.finding,
                  state: occurrence.state,
                  severity: occurrence.severity,
                }}
                showScanner
              />
            ))}
          </div>
        )}
      </section>

      <p className="text-xs font-semibold text-muted-foreground">
        Created {formatDateTime(scan.createdAt)}
        {scan.eveSessionId ? ` · Eve session ${scan.eveSessionId}` : ''}
      </p>
    </Page>
  )
}
