'use client'

import { useId, useState } from 'react'
import { cn } from '@/lib/utils'

export interface TimeseriesPoint {
  /** Tooltip heading, e.g. "12 Sep · #14". */
  readonly label: string
  readonly value: number | null
}

interface TimeseriesChartProps {
  readonly points: readonly TimeseriesPoint[]
  readonly kind: 'line' | 'bar'
  /** Series name shown in the tooltip. */
  readonly seriesLabel: string
  /** Fixed y-axis range; defaults to [0, max value]. */
  readonly domain?: readonly [number, number]
  /** Stroke/fill colour; any CSS colour, defaults to the first chart colour. */
  readonly color?: string
  readonly formatValue?: (value: number) => string
  readonly className?: string
}

const WIDTH = 400
const HEIGHT = 200
const PAD = { top: 12, right: 12, bottom: 26, left: 34 }
const TICKS = 4

/**
 * A small SSR-friendly SVG time series: one line or bar series, y grid lines
 * and a hover tooltip. It replaces Recharts for the handful of single-series
 * charts the app shows, which kept ~100 KB (gzipped) of charting code out of
 * the client bundle.
 */
export function TimeseriesChart({
  points,
  kind,
  seriesLabel,
  domain,
  color = 'var(--chart-1)',
  formatValue = (value) => String(Math.round(value * 10) / 10),
  className,
}: TimeseriesChartProps) {
  const [hover, setHover] = useState<number | null>(null)
  const titleId = useId()

  const values = points
    .map((point) => point.value)
    .filter((value): value is number => value !== null)
  const [min, max] = domain ?? [0, Math.max(1, ...values)]
  const innerWidth = WIDTH - PAD.left - PAD.right
  const innerHeight = HEIGHT - PAD.top - PAD.bottom
  const count = points.length
  const slot = count > 0 ? innerWidth / count : innerWidth
  const x = (index: number) => PAD.left + slot * index + slot / 2
  const y = (value: number) =>
    PAD.top + innerHeight - ((value - min) / (max - min || 1)) * innerHeight

  const ticks = Array.from(
    { length: TICKS + 1 },
    (_, index) => min + ((max - min) * index) / TICKS,
  )
  const linePath = points
    .map((point, index) =>
      point.value === null ? null : `${x(index)},${y(point.value)}`,
    )
    .filter((segment): segment is string => segment !== null)
    .map((segment, index) => `${index === 0 ? 'M' : 'L'}${segment}`)
    .join(' ')
  const barWidth = Math.max(4, Math.min(28, slot * 0.6))

  const labelEvery = Math.max(1, Math.ceil(count / 6))
  const hovered = hover !== null ? points[hover] : undefined

  return (
    <div className={cn('relative h-[200px] w-full text-xs', className)}>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        className="h-full w-full overflow-visible"
        role="img"
        aria-labelledby={titleId}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect()
          const ratio = (event.clientX - bounds.left) / bounds.width
          const px = ratio * WIDTH
          const index = Math.floor((px - PAD.left) / slot)
          setHover(index >= 0 && index < count ? index : null)
        }}
      >
        <title id={titleId}>{seriesLabel}</title>
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={y(tick)}
              y2={y(tick)}
              className="stroke-border/60"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={PAD.left - 6}
              y={y(tick)}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-muted-foreground"
              fontSize={10}
            >
              {formatValue(tick)}
            </text>
          </g>
        ))}
        {points.map((point, index) =>
          index % labelEvery === 0 ? (
            <text
              key={point.label}
              x={x(index)}
              y={HEIGHT - 8}
              textAnchor="middle"
              className="fill-muted-foreground"
              fontSize={10}
            >
              {point.label.split(' · ')[0]}
            </text>
          ) : null,
        )}
        {kind === 'bar'
          ? points.map((point, index) =>
              point.value === null ? null : (
                <rect
                  key={point.label}
                  x={x(index) - barWidth / 2}
                  y={y(point.value)}
                  width={barWidth}
                  height={Math.max(0, y(min) - y(point.value))}
                  rx={3}
                  fill={color}
                  opacity={hover === null || hover === index ? 1 : 0.55}
                />
              ),
            )
          : null}
        {kind === 'line' && linePath ? (
          <path
            d={linePath}
            fill="none"
            stroke={color}
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        {kind === 'line'
          ? points.map((point, index) =>
              point.value === null ? null : (
                <circle
                  key={point.label}
                  cx={x(index)}
                  cy={y(point.value)}
                  r={hover === index ? 5 : 3}
                  fill={color}
                  className="stroke-card"
                  strokeWidth={1.5}
                />
              ),
            )
          : null}
        {hover !== null ? (
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1={PAD.top}
            y2={PAD.top + innerHeight}
            className="stroke-border"
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
      </svg>
      {hovered ? (
        <div
          role="status"
          className="pointer-events-none absolute top-1 rounded-lg border border-border bg-card px-2.5 py-1.5 shadow-deep"
          style={{
            left: `${(x(hover ?? 0) / WIDTH) * 100}%`,
            transform: `translateX(${(hover ?? 0) > count / 2 ? '-105%' : '5%'})`,
          }}
        >
          <p className="font-semibold">{hovered.label}</p>
          <p className="text-muted-foreground">
            {seriesLabel}:{' '}
            <span className="font-semibold text-foreground tabular-nums">
              {hovered.value === null ? '–' : formatValue(hovered.value)}
            </span>
          </p>
        </div>
      ) : null}
    </div>
  )
}
