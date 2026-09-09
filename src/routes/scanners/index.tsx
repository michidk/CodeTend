import { createFileRoute } from '@tanstack/react-router'
import { Page, PageHeader } from '@/components/page-layout'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SCANNERS } from '@/lib/scanners'
import { CONFIDENCE_FACTOR, SEVERITY_PENALTY } from '@/lib/scoring'

export const Route = createFileRoute('/scanners/')({
  component: ScannersPage,
})

const SCANNER_STRIPES = [
  'bg-candy-sky',
  'bg-candy-pink',
  'bg-candy-lime',
  'bg-candy-grape',
  'bg-candy-sun',
  'bg-primary',
] as const

function ScannersPage() {
  return (
    <Page width="wide">
      <PageHeader
        eyebrow="Toolbox"
        title="Scanners"
        description="Every enabled scanner runs on every full scan as its own Eve subagent with read-only access to the fresh checkout."
        help="Add a scanner by appending an entry with id, name, prompt and weight to src/lib/scanners.ts. Scores are derived deterministically from findings; the model never invents numbers."
      />
      <Card className="bg-candy-sun text-ink">
        <CardHeader>
          <CardTitle>How scoring works</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm font-semibold sm:grid-cols-2">
          <div className="rounded-2xl border-[3px] border-ink bg-card p-4 shadow-toy-sm">
            <p className="font-display text-lg font-semibold">
              Penalty per open finding
            </p>
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              {Object.entries(SEVERITY_PENALTY).map(([severity, penalty]) => (
                <li key={severity} className="flex justify-between capitalize">
                  <span>{severity}</span>
                  <span className="tabular-nums">−{penalty}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border-[3px] border-ink bg-card p-4 shadow-toy-sm">
            <p className="font-display text-lg font-semibold">
              Confidence factor
            </p>
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              {Object.entries(CONFIDENCE_FACTOR).map(([confidence, factor]) => (
                <li
                  key={confidence}
                  className="flex justify-between capitalize"
                >
                  <span>{confidence}</span>
                  <span className="tabular-nums">×{factor}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs font-medium text-muted-foreground">
              Scanner score = 100 − Σ penalty × factor (floored at 0). The
              overall score is the weighted mean of scanner scores; grades: A ≥
              90, B ≥ 75, C ≥ 60, D ≥ 40, else F.
            </p>
          </div>
        </CardContent>
      </Card>
      <div className="grid gap-5 sm:gap-6 md:grid-cols-2">
        {SCANNERS.map((scanner, index) => (
          <Card
            key={scanner.id}
            className="animate-pop-in pt-0 motion-reduce:animate-none"
            style={{ animationDelay: `${Math.min(index, 8) * 60}ms` }}
          >
            <div
              className={`h-3 border-b-[3px] border-ink ${SCANNER_STRIPES[index % SCANNER_STRIPES.length]}`}
            />
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                {scanner.name}
                <Badge variant="secondary">weight {scanner.weight}</Badge>
                {!scanner.enabled ? (
                  <Badge variant="outline">disabled</Badge>
                ) : null}
              </CardTitle>
              <p className="text-sm font-semibold text-muted-foreground">
                {scanner.description}
              </p>
            </CardHeader>
            <CardContent>
              <details className="text-sm">
                <summary className="cursor-pointer font-extrabold text-link decoration-[3px] underline-offset-4 hover:underline">
                  Show prompt
                </summary>
                <p className="mt-2 whitespace-pre-wrap rounded-2xl border-[3px] border-ink bg-muted p-4 text-muted-foreground shadow-toy-inset">
                  {scanner.prompt}
                </p>
              </details>
            </CardContent>
          </Card>
        ))}
      </div>
    </Page>
  )
}
