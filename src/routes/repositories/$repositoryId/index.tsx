import {
  createFileRoute,
  Link,
  useNavigate,
  useRouter,
} from '@tanstack/react-router'
import {
  ChevronRight,
  Pencil,
  Play,
  Shield,
  Square,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { EntityNotFound } from '@/components/entity-not-found'
import { FindingCard } from '@/components/health/finding-card'
import {
  formatScore,
  GradeBadge,
  scoreTextClass,
} from '@/components/health/grade-badge'
import { ScanStatusBadge } from '@/components/health/scan-status'
import { ScoreDelta } from '@/components/health/score-delta'
import { TrendCharts } from '@/components/health/trend-charts'
import { CostCell, TokensCell } from '@/components/health/usage-stats'
import { Page, PageHeader, SectionHeading } from '@/components/page-layout'
import { RouteError } from '@/components/route-error'
import { RoutePending } from '@/components/route-pending'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  interactiveCardLinkClassName,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { FindingCounts } from '@/db/schema'
import { useActivityRefresh } from '@/hooks/use-activity-refresh'
import { getErrorMessage } from '@/lib/error-message'
import {
  formatDateTime,
  formatDuration,
  formatRelative,
  shortSha,
} from '@/lib/format'
import { parseIdParam } from '@/lib/route-params'
import { GRADE_DESCRIPTIONS, type Grade } from '@/lib/scoring'
import { cancelScan, deleteRepository } from '@/lib/server/repositories'
import {
  getRepositoryDetail,
  type RepositoryDetail,
} from '@/lib/server/repository-detail'
import { ScanDialog } from './-components/scan-dialog'

export const Route = createFileRoute('/repositories/$repositoryId/')({
  loader: ({ params }) =>
    getRepositoryDetail({ data: parseIdParam(params.repositoryId) }),
  staleTime: 5_000,
  component: RepositoryPage,
  pendingComponent: RoutePending,
  errorComponent: ({ error }) => (
    <RouteError error={error} backTo="/" backLabel="Go to dashboard" />
  ),
})

function RepositoryPage() {
  const detail = Route.useLoaderData()
  const router = useRouter()
  const navigate = useNavigate()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [scanDialogOpen, setScanDialogOpen] = useState(false)
  const running = detail?.runningScan ?? null
  const generating =
    detail?.openFindings.some(
      (finding) => finding.patches[0]?.status === 'generating',
    ) ?? false
  useActivityRefresh(
    { kind: 'repository', repositoryId: detail?.repository.id ?? 0 },
    detail !== null && (running !== null || generating),
  )

  if (!detail)
    return (
      <EntityNotFound
        entity="Repository"
        backTo="/"
        backLabel="Go to dashboard"
      />
    )
  const {
    repository,
    latestScan,
    scannerRuns,
    openFindings,
    ignoredFindings,
    openFindingsByScanner,
    history,
    timeline,
    knowledge,
    scanners,
  } = detail

  const scored = history.filter(
    (scan) => scan.status === 'completed' || scan.status === 'partial',
  )
  const previous = scored[1] ?? null
  const delta =
    latestScan?.overallScore != null && previous?.overallScore != null
      ? Math.round((latestScan.overallScore - previous.overallScore) * 10) / 10
      : null

  const stopScan = async () => {
    if (!running) return
    try {
      await cancelScan({ data: running.id })
      toast.success('Cancellation requested')
      await router.invalidate()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not cancel the scan'))
    }
  }

  const remove = async () => {
    try {
      await deleteRepository({ data: repository.id })
      toast.success('Repository deleted')
      await navigate({ to: '/' })
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not delete the repository'))
    }
  }

  return (
    <Page>
      <PageHeader
        title={repository.name}
        description={
          <>
            <a
              href={repository.url}
              className="text-link hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              {repository.url}
            </a>{' '}
            · branch <code>{repository.branch}</code>
          </>
        }
        leading={<GradeBadge grade={latestScan?.grade} size="lg" />}
        actions={
          <>
            <Button
              onClick={() => setScanDialogOpen(true)}
              disabled={running !== null}
            >
              <Play className="size-4" aria-hidden="true" />
              {running ? 'Scanning…' : 'Scan now'}
            </Button>
            <Button variant="outline" asChild>
              <Link
                to="/repositories/$repositoryId/security"
                params={{ repositoryId: String(repository.id) }}
              >
                <Shield className="size-4" aria-hidden="true" />
                Security context
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link
                to="/repositories/$repositoryId/edit"
                params={{ repositoryId: String(repository.id) }}
              >
                <Pencil className="size-4" aria-hidden="true" />
                Edit
              </Link>
            </Button>
            <Button
              variant="ghost"
              aria-label="Delete repository"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </Button>
          </>
        }
      />

      {running ? (
        <Card className="border-accent bg-accent/40">
          <CardContent className="flex flex-wrap items-center gap-3 text-sm">
            <ScanStatusBadge status={running.status} phase={running.phase} />
            <span>
              Scan #{running.id} started{' '}
              {formatRelative(running.startedAt ?? running.createdAt)}. This
              page refreshes automatically.
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void stopScan()}
              disabled={running.cancellationRequestedAt !== null}
            >
              <Square className="size-3.5" aria-hidden="true" />
              {running.cancellationRequestedAt ? 'Cancelling…' : 'Stop'}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <section
        aria-label="Current health"
        className="grid gap-3 sm:gap-4 lg:grid-cols-3"
      >
        <Card className="bg-deep text-deep-foreground shadow-deep-strong">
          <CardContent className="space-y-3">
            <p className="text-sm font-medium opacity-80">Overall score</p>
            <div className="flex items-end gap-3">
              <p className="font-display text-6xl font-bold leading-none tabular-nums">
                {formatScore(latestScan?.overallScore)}
              </p>
              <ScoreDelta
                delta={delta}
                className="mb-1 text-deep-foreground/90 [&_svg]:text-current"
              />
            </div>
            <p className="text-sm opacity-80">
              {latestScan?.grade
                ? GRADE_DESCRIPTIONS[latestScan.grade as Grade]
                : 'Run a scan to grade this repository.'}
            </p>
            {latestScan ? (
              <p className="text-xs opacity-70">
                Last scan {formatRelative(latestScan.finishedAt)} at{' '}
                {shortSha(latestScan.commitSha)} · {latestScan.fileCount ?? '?'}{' '}
                files
                {latestScan.gitnexusUsed ? ' · GitNexus' : ''}
              </p>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Findings after the latest scan</CardTitle>
          </CardHeader>
          <CardContent>
            <CountsGrid
              counts={latestScan?.counts ?? null}
              openTotal={openFindings.length}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Repository knowledge</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {knowledge ? (
              <>
                <p>
                  <span className="text-muted-foreground">Languages:</span>{' '}
                  {knowledge.summary.languages.join(', ') || '–'}
                </p>
                <p>
                  <span className="text-muted-foreground">Frameworks:</span>{' '}
                  {knowledge.summary.frameworks.join(', ') || '–'}
                </p>
                <p>
                  <span className="text-muted-foreground">Subsystems:</span>{' '}
                  {knowledge.summary.subsystems.length} · grounded in{' '}
                  {knowledge.sourceCount} files
                </p>
                <p className="text-xs text-muted-foreground">
                  Refreshed {formatRelative(knowledge.refreshedAt)} · stale
                  sections are re-verified when their source files change.
                </p>
                <Button variant="outline" size="sm" asChild>
                  <Link
                    to="/repositories/$repositoryId/knowledge"
                    params={{ repositoryId: String(repository.id) }}
                  >
                    Read overview
                    <ChevronRight className="size-4" aria-hidden="true" />
                  </Link>
                </Button>
              </>
            ) : (
              <p className="text-muted-foreground">
                Built during the first scan.
              </p>
            )}
          </CardContent>
        </Card>
      </section>

      <TrendCharts timeline={timeline} />

      <section
        aria-labelledby="scanners-heading"
        className="space-y-3 sm:space-y-4"
      >
        <SectionHeading id="scanners-heading" color="bg-candy-sky">
          Scanner scores
        </SectionHeading>
        <div className="grid gap-4 sm:grid-cols-2 sm:gap-5 xl:grid-cols-3">
          {scanners.map((scanner) => {
            const run = scannerRuns.find(
              (entry) => entry.scannerId === scanner.id,
            )
            const open = openFindingsByScanner[scanner.id] ?? 0
            return (
              <Link
                key={scanner.id}
                to="/repositories/$repositoryId/scanners/$scannerId"
                params={{
                  repositoryId: String(repository.id),
                  scannerId: scanner.id,
                }}
                className={interactiveCardLinkClassName}
              >
                <Card
                  size="sm"
                  className="h-full transition-colors group-hover:border-primary/50"
                >
                  <CardContent className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-display font-bold leading-tight">
                        {scanner.name}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {run?.status === 'failed'
                          ? 'Failed in the latest scan'
                          : `${open} open finding${open === 1 ? '' : 's'}`}
                      </p>
                    </div>
                    <p
                      className={`font-display text-3xl font-bold tabular-nums ${scoreTextClass(run?.score)}`}
                    >
                      {formatScore(run?.score)}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      </section>

      <section
        aria-labelledby="findings-heading"
        className="space-y-3 sm:space-y-4"
      >
        <SectionHeading id="findings-heading" color="bg-candy-pink">
          Active findings{' '}
          <Badge variant="outline" className="ml-1 align-middle">
            {openFindings.length}
          </Badge>
        </SectionHeading>
        {openFindings.length === 0 ? (
          <Card>
            <CardContent className="text-sm text-muted-foreground">
              {latestScan
                ? 'No open findings. Nice.'
                : 'Findings appear after the first scan.'}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {openFindings.map((finding) => (
              <FindingCard
                key={finding.id}
                finding={finding}
                showScanner
                scannerName={detail.scannerLabels[finding.scannerId]}
              />
            ))}
          </div>
        )}
      </section>

      {ignoredFindings.length > 0 ? (
        <section
          aria-labelledby="ignored-heading"
          className="space-y-3 sm:space-y-4"
        >
          <SectionHeading id="ignored-heading" color="bg-candy-sand">
            Ignored findings{' '}
            <Badge variant="outline" className="ml-1 align-middle">
              {ignoredFindings.length}
            </Badge>
          </SectionHeading>
          <p className="text-sm text-muted-foreground">
            Accepted risks and false positives with their recorded context. They
            stay out of the score and are only reopened when a scan shows the
            context no longer applies.
          </p>
          <div className="space-y-2">
            {ignoredFindings.map((finding) => (
              <FindingCard
                key={finding.id}
                finding={finding}
                showScanner
                scannerName={detail.scannerLabels[finding.scannerId]}
              />
            ))}
          </div>
        </section>
      ) : null}

      <section
        aria-labelledby="history-heading"
        className="space-y-3 sm:space-y-4"
      >
        <SectionHeading id="history-heading" color="bg-candy-grape">
          Scan history
        </SectionHeading>
        <Card className="overflow-x-auto">
          <ScanHistoryTable history={history} />
        </Card>
      </section>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {repository.name}?</DialogTitle>
            <DialogDescription>
              This removes the repository, all scans, findings and knowledge.
              The Git repository itself is not touched.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void remove()}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ScanDialog
        repositoryId={repository.id}
        open={scanDialogOpen}
        onOpenChange={setScanDialogOpen}
        onStarted={() => router.invalidate()}
      />
    </Page>
  )
}

function CountsGrid({
  counts,
  openTotal,
}: {
  readonly counts: FindingCounts | null
  readonly openTotal: number
}) {
  const entries: {
    key: keyof FindingCounts
    label: string
    className: string
  }[] = [
    { key: 'new', label: 'New', className: 'text-link' },
    { key: 'active', label: 'Active', className: 'text-foreground' },
    { key: 'improved', label: 'Improved', className: 'text-positive-text' },
    { key: 'resolved', label: 'Resolved', className: 'text-positive-text' },
    {
      key: 'regressed',
      label: 'Regressed',
      className: 'text-destructive-text',
    },
  ]
  return (
    <div className="grid grid-cols-3 gap-2 text-center">
      <div className="rounded-xl bg-secondary px-2 py-2">
        <p className="font-display text-2xl font-bold tabular-nums">
          {openTotal}
        </p>
        <p className="text-[11px] font-semibold text-muted-foreground">Open</p>
      </div>
      {entries.map((entry) => (
        <div key={entry.key} className="rounded-xl bg-secondary px-2 py-2">
          <p
            className={`font-display text-2xl font-bold tabular-nums ${entry.className}`}
          >
            {counts ? counts[entry.key] : '–'}
          </p>
          <p className="text-[11px] font-semibold text-muted-foreground">
            {entry.label}
          </p>
        </div>
      ))}
    </div>
  )
}

function ScanHistoryTable({
  history,
}: {
  readonly history: RepositoryDetail['history']
}) {
  if (history.length === 0) {
    return (
      <CardContent className="text-sm font-semibold text-muted-foreground">
        No scans yet.
      </CardContent>
    )
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Scan</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Trigger</TableHead>
          <TableHead>Commit</TableHead>
          <TableHead className="text-right">Score</TableHead>
          <TableHead className="text-right">New</TableHead>
          <TableHead className="text-right">Resolved</TableHead>
          <TableHead className="text-right">Tokens</TableHead>
          <TableHead className="text-right">Cost</TableHead>
          <TableHead className="text-right">Duration</TableHead>
          <TableHead>Finished</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {history.map((scan) => (
          <TableRow key={scan.id}>
            <TableCell>
              <Link
                to="/scans/$scanId"
                params={{ scanId: String(scan.id) }}
                className="font-extrabold text-link decoration-[3px] underline-offset-4 hover:underline"
              >
                #{scan.id}
              </Link>
            </TableCell>
            <TableCell>
              <ScanStatusBadge status={scan.status} phase={scan.phase} />
            </TableCell>
            <TableCell className="capitalize">{scan.trigger}</TableCell>
            <TableCell>
              <code className="text-xs">{shortSha(scan.commitSha)}</code>
            </TableCell>
            <TableCell
              className={`text-right font-display text-base font-bold tabular-nums ${scoreTextClass(scan.overallScore)}`}
            >
              {formatScore(scan.overallScore)}
              {scan.grade ? (
                <span className="ml-1 text-xs text-muted-foreground">
                  {scan.grade}
                </span>
              ) : null}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {scan.counts?.new ?? '–'}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {scan.counts?.resolved ?? '–'}
            </TableCell>
            <TableCell className="text-right">
              <TokensCell usage={scan} />
            </TableCell>
            <TableCell className="text-right">
              <CostCell
                value={scan.estimatedCostUsd}
                tracked={scan.modelCalls != null}
              />
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatDuration(scan.startedAt, scan.finishedAt)}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {formatDateTime(scan.finishedAt)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
