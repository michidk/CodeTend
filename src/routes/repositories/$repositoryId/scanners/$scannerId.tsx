import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { CopyButton } from '@/components/copy-button'
import { EntityNotFound } from '@/components/entity-not-found'
import { FindingCard } from '@/components/health/finding-card'
import { formatScore, scoreTextClass } from '@/components/health/grade-badge'
import { ScannerScoreChart } from '@/components/health/trend-charts'
import { Markdown } from '@/components/markdown'
import { Page, PageHeader } from '@/components/page-layout'
import { RouteError } from '@/components/route-error'
import { RoutePending } from '@/components/route-pending'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { formatRelative, shortSha } from '@/lib/format'
import { parseIdParam } from '@/lib/route-params'
import { getScanner } from '@/lib/scanners'
import { getScannerDetail } from '@/lib/server/repository-detail'

export const Route = createFileRoute(
  '/repositories/$repositoryId/scanners/$scannerId',
)({
  loader: ({ params }) => {
    if (!getScanner(params.scannerId)) throw notFound()
    return getScannerDetail({
      data: {
        repositoryId: parseIdParam(params.repositoryId),
        scannerId: params.scannerId,
      },
    })
  },
  staleTime: 5_000,
  component: ScannerDetailPage,
  pendingComponent: RoutePending,
  errorComponent: ({ error }) => (
    <RouteError error={error} backTo="/" backLabel="Go to dashboard" />
  ),
})

function ScannerDetailPage() {
  const detail = Route.useLoaderData()
  const { scannerId } = Route.useParams()
  const scanner = getScanner(scannerId)
  if (!detail || !scanner) {
    return (
      <EntityNotFound entity="Scanner" backTo="/" backLabel="Go to dashboard" />
    )
  }
  const { repository, latestRun, runs, openFindings, resolvedFindings } = detail
  const fixPrompt = latestRun?.fixPrompt ?? null

  return (
    <Page>
      <PageHeader
        eyebrow={
          <Link
            to="/repositories/$repositoryId"
            params={{ repositoryId: String(repository.id) }}
            className="inline-flex items-center gap-1 text-ink hover:underline"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            {repository.name}
          </Link>
        }
        title={scanner.name}
        description={scanner.description}
        size="compact"
        leading={
          <div className="-rotate-3 rounded-2xl border-[3px] border-ink bg-card px-4 py-3 text-center shadow-toy">
            <p
              className={`font-display text-5xl font-bold leading-none tabular-nums ${scoreTextClass(latestRun?.score)}`}
            >
              {formatScore(latestRun?.score)}
            </p>
            <p className="mt-1 text-[11px] font-extrabold uppercase tracking-wide text-muted-foreground">
              score
            </p>
          </div>
        }
        actions={
          fixPrompt ? (
            <CopyButton text={fixPrompt} label="Copy fix prompt" size="lg" />
          ) : null
        }
      />

      {latestRun?.status === 'failed' ? (
        <Card className="bg-candy-pink text-ink">
          <CardContent className="text-sm">
            <p className="font-extrabold">
              This scanner failed in the latest scan.
            </p>
            <p className="mt-1 font-semibold">{latestRun.error}</p>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-3 sm:gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Score over time</CardTitle>
          </CardHeader>
          <CardContent>
            {runs.length > 0 ? (
              <ScannerScoreChart runs={runs} label={scanner.shortName} />
            ) : (
              <p className="text-sm text-muted-foreground">
                No completed runs yet.
              </p>
            )}
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Latest assessment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {latestRun?.summary ? (
              <Markdown compact>{latestRun.summary}</Markdown>
            ) : (
              <p className="text-muted-foreground">
                Appears after the first completed scan.
              </p>
            )}
            {latestRun ? (
              <p className="text-xs text-muted-foreground">
                Scan #{latestRun.scanId} · {shortSha(latestRun.commitSha)} ·{' '}
                {formatRelative(latestRun.finishedAt)}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <section aria-labelledby="fix-heading" className="space-y-3 sm:space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="fix-heading" className="font-display text-lg font-bold">
            {scanner.fixPromptTitle}
          </h2>
          {fixPrompt ? (
            <CopyButton
              text={fixPrompt}
              label="Copy prompt"
              variant="outline"
            />
          ) : null}
        </div>
        <Card>
          <CardContent>
            {fixPrompt ? (
              <>
                <p className="mb-3 text-sm text-muted-foreground">
                  Paste this into Claude Code, Codex or another coding agent
                  working in a checkout of <code>{repository.branch}</code>. It
                  contains the current findings and asks the agent to verify
                  them, follow the repository’s conventions and fix root causes.
                </p>
                <ScrollArea className="h-80 rounded-2xl border-[3px] border-ink bg-muted shadow-toy-inset">
                  <pre className="whitespace-pre-wrap break-words p-4 text-xs leading-relaxed">
                    <code>{fixPrompt}</code>
                  </pre>
                </ScrollArea>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                The prompt is generated after the first completed scan.
              </p>
            )}
          </CardContent>
        </Card>
      </section>

      <section
        aria-labelledby="open-heading"
        className="space-y-3 sm:space-y-4"
      >
        <h2 id="open-heading" className="font-display text-lg font-bold">
          Open findings <Badge variant="secondary">{openFindings.length}</Badge>
        </h2>
        {openFindings.length === 0 ? (
          <Card>
            <CardContent className="text-sm text-muted-foreground">
              No open findings for this scanner.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {openFindings.map((finding) => (
              <FindingCard
                key={finding.id}
                finding={finding}
                defaultOpen={openFindings.length <= 3}
              />
            ))}
          </div>
        )}
      </section>

      {resolvedFindings.length > 0 ? (
        <section
          aria-labelledby="resolved-heading"
          className="space-y-3 sm:space-y-4"
        >
          <h2 id="resolved-heading" className="font-display text-lg font-bold">
            Recently resolved{' '}
            <Badge variant="secondary">{resolvedFindings.length}</Badge>
          </h2>
          <div className="space-y-2">
            {resolvedFindings.map((finding) => (
              <FindingCard key={finding.id} finding={finding} />
            ))}
          </div>
        </section>
      ) : null}

      <div>
        <Button variant="outline" asChild>
          <Link
            to="/repositories/$repositoryId"
            params={{ repositoryId: String(repository.id) }}
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to repository
          </Link>
        </Button>
      </div>
    </Page>
  )
}
