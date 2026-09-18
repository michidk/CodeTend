import { createFileRoute, Link } from '@tanstack/react-router'
import { Bot } from 'lucide-react'
import { EmptyState } from '@/components/empty-state'
import { Page, PageHeader } from '@/components/page-layout'
import { RouteError } from '@/components/route-error'
import { ListPending } from '@/components/route-pending'
import { Badge } from '@/components/ui/badge'
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
import { formatDateTime, formatDuration } from '@/lib/format'
import { getAgentHistory } from '@/lib/server/agent-history'

export const Route = createFileRoute('/agents/')({
  loader: () => getAgentHistory(),
  staleTime: 5_000,
  component: AgentHistoryPage,
  pendingComponent: ListPending,
  errorComponent: ({ error }) => <RouteError error={error} />,
})

function AgentHistoryPage() {
  const agents = Route.useLoaderData()
  const busy = agents.some(
    (agent) => agent.status === 'queued' || agent.status === 'generating',
  )
  useActivityRefresh({ kind: 'all' }, busy)

  return (
    <Page>
      <PageHeader
        eyebrow="Workforce"
        title="Fix agents"
        description="Queued and active coding agents working findings toward reviewable patch proposals."
        help="Fix work is dispatched in FIFO order up to the concurrency configured in Settings. Each row keeps the model and effort selected when it was queued."
      />
      {agents.length === 0 ? (
        <EmptyState
          icon={Bot}
          title="No fix agents yet"
          description="Generate a patch from an active finding and its agent will appear here."
          actionLabel="View repositories"
          actionHref="/"
        />
      ) : (
        <Card className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead>Repository</TableHead>
                <TableHead>Finding</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Model / effort</TableHead>
                <TableHead>Pull request</TableHead>
                <TableHead className="text-right">Duration</TableHead>
                <TableHead>Queued</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agents.map((agent) => (
                <TableRow key={agent.id}>
                  <TableCell className="font-extrabold">#{agent.id}</TableCell>
                  <TableCell>
                    <Link
                      to="/repositories/$repositoryId"
                      params={{ repositoryId: String(agent.repositoryId) }}
                      className="font-semibold hover:underline"
                    >
                      {agent.repositoryName}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-80">
                    <span className="line-clamp-2">{agent.findingTitle}</span>
                    <span className="text-xs text-muted-foreground">
                      {agent.scannerId}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        agent.status === 'failed' ? 'destructive' : 'secondary'
                      }
                      className="capitalize"
                    >
                      {agent.status === 'generating' ? 'working' : agent.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <span className="block">
                      {agent.model ?? agent.requestedModel}
                    </span>
                    <span className="capitalize">{agent.requestedEffort}</span>
                  </TableCell>
                  <TableCell>
                    {agent.pullRequest ? (
                      <a
                        href={agent.pullRequest.url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold text-link hover:underline"
                      >
                        #{agent.pullRequest.number}
                      </a>
                    ) : (
                      <span className="text-muted-foreground">–</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatDuration(agent.startedAt, agent.finishedAt)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDateTime(agent.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </Page>
  )
}
