import { createFileRoute } from '@tanstack/react-router'
import { Page, PageHeader } from '@/components/page-layout'
import { RouteError } from '@/components/route-error'
import { DetailPending } from '@/components/route-pending'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CONFIDENCE_FACTOR, SEVERITY_PENALTY } from '@/lib/scoring'
import { getGlobalScanners } from '@/lib/server/scanner-settings'
import { ScannerSettings } from './-components/scanner-settings'

export const Route = createFileRoute('/scanners/')({
  loader: () => getGlobalScanners(),
  component: ScannersPage,
  pendingComponent: DetailPending,
  errorComponent: ({ error }) => <RouteError error={error} />,
})

function ScannersPage() {
  const scanners = Route.useLoaderData()
  return (
    <Page width="wide">
      <PageHeader
        title="Scanners"
        description="Choose which scanners run across every repository and add organization-specific review dimensions."
        help="Scanner settings are global. Changes affect new scans; scans already in progress keep the scanner definitions they started with. Scores are derived deterministically from findings; the model never invents numbers."
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
      <ScannerSettings scanners={scanners} />
    </Page>
  )
}
