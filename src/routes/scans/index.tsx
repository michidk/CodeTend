import { createFileRoute, Link } from '@tanstack/react-router'
import { History } from 'lucide-react'
import { EmptyState } from '@/components/empty-state'
import { formatScore, scoreTextClass } from '@/components/health/grade-badge'
import { ScanStatusBadge } from '@/components/health/scan-status'
import { CostCell, StatTile, TokensCell } from '@/components/health/usage-stats'
import { Page, PageHeader, SectionHeading } from '@/components/page-layout'
import { RouteError } from '@/components/route-error'
import { ListPending } from '@/components/route-pending'
import { Card } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useActivityRefresh } from '@/hooks/use-activity-refresh'
import {
  formatCostUsd,
  formatDateTime,
  formatDuration,
  formatTokens,
  shortSha,
} from '@/lib/format'
import { getScanHistory } from '@/lib/server/scan-history'

export const Route = createFileRoute('/scans/')({
  loader: () => getScanHistory(),
  staleTime: 5_000,
  component: ScanHistoryPage,
  pendingComponent: ListPending,
  errorComponent: ({ error }) => <RouteError error={error} />,
})

function ScanHistoryPage() {
  const { scans, totals } = Route.useLoaderData()
  const scanning = scans.some(
    (scan) => scan.status === 'queued' || scan.status === 'running',
  )
  useActivityRefresh({ kind: 'all' }, scanning)

  const totalTokens =
    totals.inputTokens +
    totals.outputTokens +
    totals.cacheReadTokens +
    totals.cacheWriteTokens
  const cachedTokens = totals.cacheReadTokens + totals.cacheWriteTokens
  const unpriced = totals.trackedScans - totals.pricedScans
  const untracked = totals.scans - totals.trackedScans
  const costHint = [
    unpriced > 0
      ? `${unpriced} tracked scan${unpriced === 1 ? '' : 's'} without a known model price`
      : null,
    untracked > 0
      ? `${untracked} scan${untracked === 1 ? '' : 's'} without recorded usage`
      : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <Page>
      <PageHeader
        eyebrow="Ledger"
        title="Scan history"
        description="Every scan run across all repositories, with the tokens it consumed and what that cost."
        help="Token counts come straight from the model provider for every root, knowledge and scanner model step. Cost is estimated from provider list prices (cache reads at 10%, cache writes at 125% of the input price); scans on a model without a known price show tokens but no cost."
      />

      <section aria-labelledby="totals-heading" className="space-y-3">
        <SectionHeading id="totals-heading" color="bg-candy-lime">
          All-time usage
        </SectionHeading>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <StatTile label="Scans" value={totals.scans} />
          <StatTile
            label="Model calls"
            value={formatTokens(totals.modelCalls)}
          />
          <StatTile
            label="Tokens"
            value={formatTokens(totalTokens)}
            hint={
              <span>
                {formatTokens(totals.inputTokens)} in ·{' '}
                {formatTokens(cachedTokens)} cached ·{' '}
                {formatTokens(totals.outputTokens)} out
              </span>
            }
          />
          <StatTile
            label="Estimated cost"
            value={
              totals.pricedScans > 0
                ? formatCostUsd(totals.estimatedCostUsd)
                : '–'
            }
            className="bg-candy-sun"
            hint={costHint || undefined}
          />
          <StatTile
            label="Per scan"
            value={
              totals.pricedScans > 0
                ? formatCostUsd(totals.estimatedCostUsd / totals.pricedScans)
                : '–'
            }
            hint="average across priced scans"
          />
        </div>
      </section>

      <section aria-labelledby="runs-heading" className="space-y-3">
        <SectionHeading id="runs-heading" color="bg-candy-grape">
          Runs
        </SectionHeading>
        {scans.length === 0 ? (
          <EmptyState
            icon={History}
            title="No scans yet"
            description="Add a repository and start a scan; every run will show up here with its token usage."
            actionLabel="Go to dashboard"
            actionHref="/"
          />
        ) : (
          <Card className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Scan</TableHead>
                  <TableHead>Repository</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Commit</TableHead>
                  <TableHead className="text-right">Score</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead className="text-right">Tokens</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                  <TableHead>Started</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scans.map((scan) => (
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
                      <Link
                        to="/repositories/$repositoryId"
                        params={{ repositoryId: String(scan.repositoryId) }}
                        className="font-semibold hover:underline"
                      >
                        {scan.repositoryName}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <ScanStatusBadge
                        status={scan.status}
                        phase={scan.phase}
                      />
                    </TableCell>
                    <TableCell className="capitalize">{scan.trigger}</TableCell>
                    <TableCell>
                      <code className="text-xs">
                        {shortSha(scan.commitSha)}
                      </code>
                    </TableCell>
                    <TableCell
                      className={`text-right font-display text-base font-bold tabular-nums ${scoreTextClass(scan.overallScore)}`}
                    >
                      {formatScore(scan.overallScore)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {scan.model ?? scan.requestedModel}
                      {scan.status === 'queued' ? (
                        <span className="block capitalize">
                          {scan.requestedEffort} effort
                        </span>
                      ) : null}
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
                      {formatDateTime(scan.startedAt ?? scan.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </section>
    </Page>
  )
}
