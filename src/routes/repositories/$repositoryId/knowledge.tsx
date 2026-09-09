import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { CopyButton } from '@/components/copy-button'
import { EntityNotFound } from '@/components/entity-not-found'
import { Page, PageHeader } from '@/components/page-layout'
import { RouteError } from '@/components/route-error'
import { RoutePending } from '@/components/route-pending'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatRelative, shortSha } from '@/lib/format'
import { parseIdParam } from '@/lib/route-params'
import { getRepositoryKnowledge } from '@/lib/server/knowledge'

export const Route = createFileRoute('/repositories/$repositoryId/knowledge')({
  loader: ({ params }) =>
    getRepositoryKnowledge({ data: parseIdParam(params.repositoryId) }),
  component: KnowledgePage,
  pendingComponent: RoutePending,
  errorComponent: ({ error }) => (
    <RouteError error={error} backTo="/" backLabel="Go to dashboard" />
  ),
})

function KnowledgePage() {
  const data = Route.useLoaderData()
  if (!data)
    return (
      <EntityNotFound
        entity="Repository"
        backTo="/"
        backLabel="Go to dashboard"
      />
    )
  const { repository, knowledge } = data

  return (
    <Page width="wide">
      <PageHeader
        eyebrow={
          <Link
            to="/repositories/$repositoryId"
            params={{ repositoryId: String(repository.id) }}
            className="inline-flex items-center gap-1 text-link hover:underline"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            {repository.name}
          </Link>
        }
        title="Repository knowledge"
        description="Persistent, source-grounded understanding that scanners receive so they do not rediscover the repository on every scan. Source code stays authoritative; sections are re-verified when the files they depend on change."
        size="compact"
        actions={
          knowledge ? (
            <CopyButton
              text={knowledge.overview}
              label="Copy overview"
              variant="outline"
            />
          ) : null
        }
      />
      {!knowledge ? (
        <Card>
          <CardContent className="text-sm text-muted-foreground">
            Knowledge is built during the first scan.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:gap-4 lg:grid-cols-3">
          <div className="space-y-3 sm:space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Snapshot</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <p>
                  Commit{' '}
                  <code className="text-xs">
                    {shortSha(knowledge.commitSha)}
                  </code>
                </p>
                <p>{knowledge.fileCount ?? '?'} tracked files</p>
                <p>Refreshed {formatRelative(knowledge.refreshedAt)}</p>
                <p>Grounded in {knowledge.sources.length} source files</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Stack</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-1.5">
                {[
                  ...knowledge.summary.languages,
                  ...knowledge.summary.frameworks,
                ].map((item) => (
                  <Badge key={item} variant="secondary">
                    {item}
                  </Badge>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Subsystems</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  {knowledge.summary.subsystems.map((subsystem) => (
                    <li key={subsystem.name}>
                      <p className="font-semibold">{subsystem.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {subsystem.paths.join(', ')}
                      </p>
                      <p className="text-muted-foreground">
                        {subsystem.responsibility}
                      </p>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Domain concepts</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-1.5">
                {knowledge.summary.concepts.map((concept) => (
                  <Badge key={concept} variant="outline">
                    {concept}
                  </Badge>
                ))}
              </CardContent>
            </Card>
          </div>
          <Card className="lg:col-span-2">
            <CardContent>
              <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">
                {knowledge.overview}
              </pre>
            </CardContent>
          </Card>
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle>Grounding files</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="grid gap-1 text-xs sm:grid-cols-2 lg:grid-cols-3">
                {knowledge.sources.map((source) => (
                  <li
                    key={source.path}
                    className="flex justify-between gap-2 truncate"
                  >
                    <code className="truncate">{source.path}</code>
                    <span className="shrink-0 text-muted-foreground">
                      {source.hash.slice(0, 8)}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      )}
    </Page>
  )
}
