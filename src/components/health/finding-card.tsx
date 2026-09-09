import { ChevronDown } from 'lucide-react'
import {
  ConfidenceBadge,
  FindingStateBadge,
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
import type { Finding } from '@/db/schema'
import { formatLocation } from '@/lib/fix-prompt'
import { getScanner } from '@/lib/scanners'

type FindingCardData = Pick<
  Finding,
  | 'id'
  | 'title'
  | 'severity'
  | 'confidence'
  | 'state'
  | 'description'
  | 'whyItMatters'
  | 'recommendation'
  | 'effort'
  | 'locations'
  | 'scannerId'
>

export function FindingCard({
  finding,
  showScanner = false,
  defaultOpen = false,
}: {
  readonly finding: FindingCardData
  readonly showScanner?: boolean
  readonly defaultOpen?: boolean
}) {
  const scanner = getScanner(finding.scannerId)
  return (
    <Card size="sm">
      <Collapsible defaultOpen={defaultOpen} className="contents">
        <CollapsibleTrigger className="group flex w-full items-start justify-between gap-3 px-(--card-spacing) text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <div className="min-w-0 space-y-1.5">
            <p className="font-display text-base font-bold leading-snug">
              {finding.title}
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              <SeverityBadge severity={finding.severity} />
              <ConfidenceBadge confidence={finding.confidence} />
              <FindingStateBadge state={finding.state} />
              <Badge variant="outline" className="capitalize">
                effort: {finding.effort}
              </Badge>
              {showScanner && scanner ? (
                <Badge variant="secondary">{scanner.shortName}</Badge>
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
            <Section title="Evidence">{finding.description}</Section>
            <Section title="Why it matters">{finding.whyItMatters}</Section>
            <Section title="Recommendation">{finding.recommendation}</Section>
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
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
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
