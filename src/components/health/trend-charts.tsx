import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { TimeseriesChart } from '@/components/ui/timeseries-chart'
import { formatShortDate } from '@/lib/format'

export interface TimelinePoint {
  readonly scanId: number
  readonly at: string
  readonly overallScore: number | null
  readonly activeFindings: number
  readonly scanners: Record<string, number | null>
}

function labelFor(point: { readonly at: string; readonly scanId: number }) {
  return `${formatShortDate(point.at)} · #${point.scanId}`
}

export function TrendCharts({
  timeline,
}: {
  readonly timeline: readonly TimelinePoint[]
}) {
  const tooFew = timeline.length < 2

  return (
    <section aria-labelledby="trend-heading" className="space-y-3 sm:space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="trend-heading" className="font-display text-lg font-bold">
          Change over time
        </h2>
        {tooFew ? (
          <p className="text-xs text-muted-foreground">
            Trends appear after the second scan.
          </p>
        ) : null}
      </div>
      <div className="grid gap-3 sm:gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle as="h3">Overall score</CardTitle>
          </CardHeader>
          <CardContent>
            <TimeseriesChart
              kind="line"
              seriesLabel="Overall score"
              domain={[0, 100]}
              color="var(--chart-1)"
              points={timeline.map((point) => ({
                label: labelFor(point),
                value: point.overallScore,
              }))}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle as="h3">Active findings</CardTitle>
          </CardHeader>
          <CardContent>
            <TimeseriesChart
              kind="bar"
              seriesLabel="Active findings"
              color="var(--chart-3)"
              formatValue={(value) => String(Math.round(value))}
              points={timeline.map((point) => ({
                label: labelFor(point),
                value: point.activeFindings,
              }))}
            />
          </CardContent>
        </Card>
      </div>
    </section>
  )
}

export function ScannerScoreChart({
  runs,
  label,
}: {
  readonly runs: readonly { scanId: number; at: string; score: number | null }[]
  readonly label: string
}) {
  return (
    <TimeseriesChart
      kind="line"
      seriesLabel={label}
      domain={[0, 100]}
      points={runs.map((run) => ({ label: labelFor(run), value: run.score }))}
    />
  )
}
