import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { FolderGit2, Play } from 'lucide-react'
import { toast } from 'sonner'
import { EmptyState } from '@/components/empty-state'
import {
  formatScore,
  GradeBadge,
  scoreTextClass,
} from '@/components/health/grade-badge'
import { ScanStatusBadge } from '@/components/health/scan-status'
import { ScoreDelta } from '@/components/health/score-delta'
import { Page, PageHeader } from '@/components/page-layout'
import { RouteError } from '@/components/route-error'
import { ListPending } from '@/components/route-pending'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useActivityRefresh } from '@/hooks/use-activity-refresh'
import { getErrorMessage } from '@/lib/error-message'
import { formatRelative } from '@/lib/format'
import {
  type DashboardRow,
  getDashboard,
  triggerScan,
} from '@/lib/server/repositories'

export const Route = createFileRoute('/')({
  loader: () => getDashboard(),
  staleTime: 5_000,
  component: DashboardPage,
  pendingComponent: ListPending,
  errorComponent: ({ error }) => <RouteError error={error} />,
})

function DashboardPage() {
  const rows = Route.useLoaderData()
  const router = useRouter()
  const scanning = rows.some((row) => row.runningScan !== null)
  useActivityRefresh({ kind: 'all' }, scanning)

  const scanNow = async (row: DashboardRow) => {
    try {
      await triggerScan({
        data: { repositoryId: row.id, mode: 'standard' },
      })
      toast.success(`Scan started for ${row.name}`)
      await router.invalidate()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not start the scan'))
    }
  }

  return (
    <Page>
      <PageHeader
        title="Repository health"
        description="Every registered repository, its latest grade and whether it is getting healthier or accumulating debt."
        help="Each scan clones the configured branch, runs every specialized scanner over the whole repository and scores the result deterministically from the findings."
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={FolderGit2}
          title="No repositories yet"
          description="Register a repository and CodeTend will scan it on the configured schedule."
          actionLabel="Add repository"
          actionHref="/repositories/new"
        />
      ) : (
        <div className="grid gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => (
            <RepositoryCard
              key={row.id}
              row={row}
              onScanNow={() => void scanNow(row)}
            />
          ))}
        </div>
      )}
    </Page>
  )
}

function RepositoryCard({
  row,
  onScanNow,
}: {
  readonly row: DashboardRow
  readonly onScanNow: () => void
}) {
  const latest = row.latestScan
  return (
    <Card className="h-full">
      <CardContent className="flex h-full flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link
              to="/repositories/$repositoryId"
              params={{ repositoryId: String(row.id) }}
              className="font-display text-lg font-bold leading-tight hover:underline"
            >
              {row.name}
            </Link>
            <p
              className="mt-0.5 truncate text-xs text-muted-foreground"
              title={row.url}
            >
              {row.url.replace(/^https?:\/\//, '')} · {row.branch}
            </p>
          </div>
          <GradeBadge grade={latest?.grade} />
        </div>

        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground">Score</p>
            <p
              className={`font-display text-4xl font-bold leading-none tabular-nums ${scoreTextClass(latest?.overallScore)}`}
            >
              {formatScore(latest?.overallScore)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs font-medium text-muted-foreground">
              Active findings
            </p>
            <p className="font-display text-2xl font-bold leading-none tabular-nums">
              {row.activeFindings}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ScoreDelta delta={row.scoreDelta} />
          {row.runningScan ? (
            <ScanStatusBadge
              status={row.runningScan.status}
              phase={row.runningScan.phase}
            />
          ) : latest ? (
            <ScanStatusBadge status={latest.status} />
          ) : (
            <Badge variant="secondary">not scanned yet</Badge>
          )}
        </div>

        <dl className="mt-auto grid grid-cols-2 gap-x-3 border-t border-border/70 pt-3 text-xs">
          <dt className="text-muted-foreground">Last scan</dt>
          <dd className="text-right tabular-nums">
            {formatRelative(row.lastScanAt)}
          </dd>
        </dl>

        <div className="flex gap-2">
          <Button
            size="sm"
            className="flex-1"
            onClick={onScanNow}
            disabled={row.runningScan !== null}
          >
            <Play className="size-4" aria-hidden="true" />
            {row.runningScan ? 'Scanning…' : 'Scan now'}
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link
              to="/repositories/$repositoryId"
              params={{ repositoryId: String(row.id) }}
            >
              Details
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
