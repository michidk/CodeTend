import { createFileRoute } from '@tanstack/react-router'
import { Page, PageHeader } from '@/components/page-layout'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SCANNERS } from '@/lib/scanners'
import { CONFIDENCE_FACTOR, SEVERITY_PENALTY } from '@/lib/scoring'

export const Route = createFileRoute('/scanners/')({
  component: ScannersPage,
})

function ScannersPage() {
  return (
    <Page width="wide">
      <PageHeader
        title="Scanners"
        description="Every enabled scanner runs on every full scan as its own Eve subagent with read-only access to the fresh checkout."
        help="Add a scanner by appending an entry with id, name, prompt and weight to src/lib/scanners.ts. Scores are derived deterministically from findings; the model never invents numbers."
      />
      <Card>
        <CardHeader>
          <CardTitle>Scoring</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <p className="font-semibold">Penalty per open finding</p>
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              {Object.entries(SEVERITY_PENALTY).map(([severity, penalty]) => (
                <li key={severity} className="flex justify-between capitalize">
                  <span>{severity}</span>
                  <span className="tabular-nums">−{penalty}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="font-semibold">Confidence factor</p>
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
            <p className="mt-2 text-xs text-muted-foreground">
              Scanner score = 100 − Σ penalty × factor (floored at 0). The
              overall score is the weighted mean of scanner scores; grades: A ≥
              90, B ≥ 75, C ≥ 60, D ≥ 40, else F.
            </p>
          </div>
        </CardContent>
      </Card>
      <div className="grid gap-3 sm:gap-4 md:grid-cols-2">
        {SCANNERS.map((scanner) => (
          <Card key={scanner.id}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                {scanner.name}
                <Badge variant="secondary">weight {scanner.weight}</Badge>
                {!scanner.enabled ? (
                  <Badge variant="outline">disabled</Badge>
                ) : null}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {scanner.description}
              </p>
            </CardHeader>
            <CardContent>
              <details className="text-sm">
                <summary className="cursor-pointer font-semibold text-link">
                  Prompt
                </summary>
                <p className="mt-2 whitespace-pre-wrap text-muted-foreground">
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
