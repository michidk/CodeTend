import { ChevronDown } from 'lucide-react'
import {
  FindingCard,
  type FindingSummary,
} from '@/components/health/finding-card'
import { Badge } from '@/components/ui/badge'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import type { Finding } from '@/db/schema'
import { getScanner } from '@/lib/scanners'

interface ScanFindingOccurrence {
  readonly id: number
  readonly finding: FindingSummary
  readonly state: Finding['state']
  readonly confidence: Finding['confidence']
}

export function FindingGroups({
  occurrences,
  scannerNames,
}: {
  readonly occurrences: readonly ScanFindingOccurrence[]
  readonly scannerNames: Readonly<Record<string, string | undefined>>
}) {
  const groups = new Map<string, ScanFindingOccurrence[]>()

  for (const occurrence of occurrences) {
    const scannerId = occurrence.finding.scannerId
    const group = groups.get(scannerId)
    if (group) group.push(occurrence)
    else groups.set(scannerId, [occurrence])
  }

  return (
    <div className="space-y-2">
      {[...groups].map(([scannerId, findings]) => {
        const scannerName =
          scannerNames[scannerId] ??
          getScanner(scannerId)?.shortName ??
          scannerId

        return (
          <Collapsible
            key={scannerId}
            className="group overflow-hidden rounded-xl border bg-card"
          >
            <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
              <span className="font-display text-base font-bold">
                {scannerName}
              </span>
              <span className="flex items-center gap-2">
                <Badge variant="secondary" className="tabular-nums">
                  {findings.length}
                </Badge>
                <ChevronDown
                  aria-hidden="true"
                  className="size-5 text-muted-foreground transition-transform group-data-[open]:rotate-180 motion-reduce:transition-none"
                />
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent className="border-t p-2 data-open:animate-in data-open:fade-in-0 data-open:slide-in-from-top-1 data-closed:animate-out data-closed:fade-out-0 motion-reduce:animate-none">
              <div className="space-y-2">
                {findings.map((occurrence) => (
                  <FindingCard
                    key={occurrence.id}
                    finding={occurrence.finding}
                    snapshot={{
                      state: occurrence.state,
                      confidence: occurrence.confidence,
                    }}
                  />
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )
      })}
    </div>
  )
}
