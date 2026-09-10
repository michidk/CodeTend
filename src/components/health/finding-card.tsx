import { useRouter } from '@tanstack/react-router'
import { ChevronDown } from 'lucide-react'
import { useEffect, useState } from 'react'
import { FindingHistory } from '@/components/health/finding-history'
import { FindingPatchControls } from '@/components/health/finding-patch-controls'
import { FindingRiskDetails } from '@/components/health/finding-risk-details'
import { FindingTriageControls } from '@/components/health/finding-triage-controls'
import {
  ConfidenceBadge,
  FindingStateBadge,
  PriorityBadge,
  SeverityBadge,
} from '@/components/health/severity-badge'
import { Markdown } from '@/components/markdown'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Skeleton } from '@/components/ui/skeleton'
import type { Finding, FindingEvent } from '@/db/schema'
import { getErrorMessage } from '@/lib/error-message'
import { formatLocation } from '@/lib/fix-prompt'
import { getScanner } from '@/lib/scanners'
import {
  type FindingDetail,
  getFindingDetail,
} from '@/lib/server/finding-detail'

/**
 * What a list row knows about a finding. Everything else (long-form text,
 * evidence, validations, patches, history) is loaded when the card opens so
 * list pages stay small even with hundreds of findings.
 */
export type FindingSummary = Pick<
  Finding,
  | 'id'
  | 'title'
  | 'severity'
  | 'confidence'
  | 'state'
  | 'effort'
  | 'scannerId'
  | 'priority'
  | 'priorityScore'
  | 'disposition'
  | 'dispositionNote'
> & {
  /** Latest event only; the full history arrives with the detail. */
  readonly events?: readonly FindingEventSummary[]
  readonly patches?: readonly { readonly status: string }[]
}

type FindingEventSummary = Pick<FindingEvent, 'kind' | 'disposition' | 'note'>

/** Occurrence-level overrides shown on a scan page instead of the latest values. */
export interface FindingSnapshot {
  readonly state: Finding['state']
  readonly severity: Finding['severity']
  readonly confidence: Finding['confidence']
  readonly priority: Finding['priority']
  readonly priorityScore: Finding['priorityScore']
}

export function FindingCard({
  finding,
  snapshot,
  showScanner = false,
  defaultOpen = false,
}: {
  readonly finding: FindingSummary
  readonly snapshot?: FindingSnapshot
  readonly showScanner?: boolean
  readonly defaultOpen?: boolean
}) {
  const scanner = getScanner(finding.scannerId)
  const [open, setOpen] = useState(defaultOpen)
  const shown = { ...finding, ...snapshot }
  const latestEvent = finding.events?.[0]
  const reopenedByScanner =
    latestEvent?.kind === 'disposition_invalidated' &&
    finding.disposition === null &&
    finding.state !== 'resolved'
      ? latestEvent
      : null

  return (
    <Card size="sm">
      <Collapsible open={open} onOpenChange={setOpen} className="contents">
        <CollapsibleTrigger className="group flex w-full items-start justify-between gap-3 px-(--card-spacing) text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <div className="min-w-0 space-y-1.5">
            <p className="font-display text-base font-bold leading-snug">
              {finding.title}
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              {shown.priority ? (
                <PriorityBadge
                  priority={shown.priority}
                  score={shown.priorityScore}
                />
              ) : null}
              <SeverityBadge severity={shown.severity} />
              <ConfidenceBadge confidence={shown.confidence} />
              <FindingStateBadge
                state={shown.state}
                disposition={finding.disposition}
              />
              <Badge variant="outline" className="capitalize">
                effort: {finding.effort}
              </Badge>
              {showScanner && scanner ? (
                <Badge variant="secondary">{scanner.shortName}</Badge>
              ) : null}
              {reopenedByScanner ? (
                <Badge className="border-transparent bg-destructive/15 text-destructive-text">
                  reopened by scanner
                </Badge>
              ) : null}
            </div>
          </div>
          <ChevronDown
            aria-hidden="true"
            className="mt-1 size-5 shrink-0 text-muted-foreground transition-transform group-data-[open]:rotate-180 motion-reduce:transition-none"
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-3 pt-3 text-sm">
            {open ? (
              <FindingDetailPanel
                findingId={finding.id}
                snapshot={snapshot}
                reopenedByScanner={reopenedByScanner}
              />
            ) : null}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}

function FindingDetailPanel({
  findingId,
  snapshot,
  reopenedByScanner,
}: {
  readonly findingId: number
  readonly snapshot?: FindingSnapshot
  readonly reopenedByScanner: FindingEventSummary | null
}) {
  const detail = useFindingDetail(findingId)

  if (detail.status === 'error') {
    return (
      <p className="text-sm text-destructive-text">
        Could not load this finding: {detail.message}
      </p>
    )
  }
  if (detail.status === 'loading') return <DetailSkeleton />
  if (!detail.finding) {
    return (
      <p className="text-sm text-muted-foreground">
        This finding no longer exists.
      </p>
    )
  }

  const finding = { ...detail.finding, ...snapshot }
  return (
    <>
      {reopenedByScanner ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3">
          <p className="font-semibold">
            Reopened by the scanner
            {reopenedByScanner.disposition
              ? ` — the ${reopenedByScanner.disposition.replace('_', ' ')} context no longer holds`
              : ''}
          </p>
          {reopenedByScanner.note ? (
            <p className="mt-1 whitespace-pre-wrap text-xs">
              {reopenedByScanner.note}
            </p>
          ) : null}
        </div>
      ) : null}
      <FindingRiskDetails finding={finding} />
      {finding.rootCause ? (
        <Section title="Root cause">{finding.rootCause}</Section>
      ) : null}
      <Section title="Evidence">{finding.description}</Section>
      {finding.codeEvidence && finding.codeEvidence.length > 0 ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Code evidence
          </p>
          <ul className="mt-1 space-y-2">
            {finding.codeEvidence.map((evidence) => (
              <li
                key={JSON.stringify(evidence)}
                className="rounded-xl bg-muted p-2"
              >
                <p className="font-semibold capitalize">
                  {evidence.role.replaceAll('_', ' ')} ·{' '}
                  <code>{formatLocation(evidence)}</code>
                </p>
                {evidence.excerpt ? (
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg bg-background p-2 text-xs">
                    {evidence.excerpt}
                  </pre>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {finding.attackPath ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Attack path
          </p>
          <ol className="mt-1 list-decimal space-y-1 pl-5">
            {finding.attackPath.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p className="mt-2 text-muted-foreground">
            Preconditions:{' '}
            {finding.attackPath.preconditions.join('; ') || 'none stated'}
          </p>
          <p className="mt-1 font-medium">
            Impact: {finding.attackPath.impact}
          </p>
        </div>
      ) : null}
      <Section title="Why it matters">{finding.whyItMatters}</Section>
      <Section title="Recommendation">{finding.recommendation}</Section>
      {finding.validations.map((validation) => (
        <div
          key={validation.id}
          className="rounded-xl border border-border bg-muted/40 p-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Validation
            </p>
            <Badge variant="outline" className="capitalize">
              {validation.status.replaceAll('_', ' ')}
            </Badge>
            <code className="text-xs">{validation.runner}</code>
          </div>
          <p className="mt-2">{validation.summary}</p>
          {validation.commands.length > 0 ? (
            <ol className="mt-2 space-y-2">
              {validation.commands.map((command) => (
                <li key={JSON.stringify(command)}>
                  <code className="block overflow-x-auto rounded-lg bg-background p-2 text-xs">
                    $ {command.command}
                  </code>
                  <p className="mt-1 text-xs text-muted-foreground">
                    exit {command.exitCode ?? 'n/a'} · {command.durationMs}ms
                    {command.timedOut ? ' · timed out' : ''}
                  </p>
                </li>
              ))}
            </ol>
          ) : null}
          {validation.proofGaps.length > 0 ? (
            <ul className="mt-2 list-disc pl-5 text-xs text-muted-foreground">
              {validation.proofGaps.map((gap) => (
                <li key={gap}>{gap}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}
      {finding.remediationTests && finding.remediationTests.length > 0 ? (
        <StringList
          title="Remediation verification"
          values={finding.remediationTests}
        />
      ) : null}
      {finding.preventiveControls && finding.preventiveControls.length > 0 ? (
        <StringList
          title="Preventive controls"
          values={finding.preventiveControls}
        />
      ) : null}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Locations
        </p>
        <ul className="mt-1 space-y-0.5">
          {finding.locations.map((location) => (
            <li
              key={`${location.path}:${location.startLine ?? ''}:${location.symbol ?? ''}`}
            >
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                {formatLocation(location)}
              </code>
            </li>
          ))}
        </ul>
      </div>
      <FindingTriageControls
        findingId={finding.id}
        disposition={finding.disposition}
        dispositionNote={finding.dispositionNote}
      />
      <FindingHistory events={finding.events} />
      <FindingPatchControls
        findingId={finding.id}
        patches={finding.patches}
        disabled={finding.disposition !== null || finding.state === 'resolved'}
      />
    </>
  )
}

type DetailState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly finding: FindingDetail | null }

/**
 * Loads the detail once per open and again whenever the route data changes
 * (triage, patch decisions and polling all go through `router.invalidate()`),
 * so an expanded card never shows stale controls.
 */
function useFindingDetail(findingId: number): DetailState {
  const router = useRouter()
  const [state, setState] = useState<DetailState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    const load = () => {
      getFindingDetail({ data: findingId })
        .then((finding) => {
          if (!cancelled) setState({ status: 'ready', finding })
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setState({
              status: 'error',
              message: getErrorMessage(error, 'Unknown error'),
            })
          }
        })
    }
    load()
    const unsubscribe = router.subscribe('onResolved', load)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [findingId, router])

  return state
}

function DetailSkeleton() {
  return (
    <div
      className="space-y-3"
      role="status"
      aria-busy="true"
      aria-label="Loading finding"
    >
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-11/12" />
      <Skeleton className="h-3 w-28" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  )
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
      <ul className="mt-1 list-disc space-y-1 pl-5">
        {values.map((value) => (
          <li key={value}>{value}</li>
        ))}
      </ul>
    </div>
  )
}

function Section({
  title,
  children,
}: {
  readonly title: string
  readonly children: string
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <Markdown compact className="mt-1">
        {children}
      </Markdown>
    </div>
  )
}
