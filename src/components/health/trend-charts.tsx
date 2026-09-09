import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import { formatShortDate } from '@/lib/format'
import { enabledScanners } from '@/lib/scanners'

export interface TimelinePoint {
  readonly scanId: number
  readonly at: string
  readonly overallScore: number | null
  readonly activeFindings: number
  readonly scanners: Record<string, number | null>
}

const SCANNER_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--grade-a)',
  'var(--grade-d)',
  'var(--deep)',
  'var(--warning)',
  'var(--positive)',
  'var(--destructive)',
]

const overallConfig: ChartConfig = {
  overallScore: { label: 'Overall score', color: 'var(--chart-1)' },
}

const findingsConfig: ChartConfig = {
  activeFindings: { label: 'Active findings', color: 'var(--chart-3)' },
}

const scannerConfig: ChartConfig = Object.fromEntries(
  enabledScanners.map((scanner, index) => [
    scanner.id,
    {
      label: scanner.shortName,
      color: SCANNER_COLORS[index % SCANNER_COLORS.length],
    },
  ]),
)

function labelFor(point: TimelinePoint): string {
  return `${formatShortDate(point.at)} · #${point.scanId}`
}

export function TrendCharts({
  timeline,
}: {
  readonly timeline: readonly TimelinePoint[]
}) {
  const data = timeline.map((point) => ({
    ...point,
    ...point.scanners,
    label: labelFor(point),
  }))
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
            <ChartContainer
              config={overallConfig}
              className="h-[200px] w-full aspect-auto"
            >
              <LineChart data={data} margin={{ left: -12, right: 12, top: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={24}
                />
                <YAxis domain={[0, 100]} tickLine={false} axisLine={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line
                  type="monotone"
                  dataKey="overallScore"
                  stroke="var(--color-overallScore)"
                  strokeWidth={2.5}
                  dot={{ r: 3 }}
                  connectNulls
                  isAnimationActive={false}
                />
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle as="h3">Active findings</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer
              config={findingsConfig}
              className="h-[200px] w-full aspect-auto"
            >
              <BarChart data={data} margin={{ left: -12, right: 12, top: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={24}
                />
                <YAxis
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar
                  dataKey="activeFindings"
                  fill="var(--color-activeFindings)"
                  radius={6}
                  isAnimationActive={false}
                />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle as="h3">Scanner scores</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer
              config={scannerConfig}
              className="h-[280px] w-full aspect-auto"
            >
              <LineChart data={data} margin={{ left: -12, right: 12, top: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={24}
                />
                <YAxis domain={[0, 100]} tickLine={false} axisLine={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <ChartLegend content={<ChartLegendContent />} />
                {enabledScanners.map((scanner) => (
                  <Line
                    key={scanner.id}
                    type="monotone"
                    dataKey={scanner.id}
                    stroke={`var(--color-${scanner.id})`}
                    strokeWidth={1.75}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ChartContainer>
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
  const config: ChartConfig = { score: { label, color: 'var(--chart-1)' } }
  const data = runs.map((run) => ({
    ...run,
    label: `${formatShortDate(run.at)} · #${run.scanId}`,
  }))
  return (
    <ChartContainer config={config} className="h-[200px] w-full aspect-auto">
      <LineChart data={data} margin={{ left: -12, right: 12, top: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={24}
        />
        <YAxis domain={[0, 100]} tickLine={false} axisLine={false} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Line
          type="monotone"
          dataKey="score"
          stroke="var(--color-score)"
          strokeWidth={2.5}
          dot={{ r: 3 }}
          connectNulls
          isAnimationActive={false}
        />
      </LineChart>
    </ChartContainer>
  )
}
