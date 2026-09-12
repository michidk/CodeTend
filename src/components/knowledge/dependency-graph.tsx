import type { KnowledgeSubsystem, SubsystemDependencyGraph } from '@/db/schema'

const CHART_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
]

const SIZE = 360
const CENTER = SIZE / 2
const RADIUS = SIZE / 2 - 56

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function layoutNodes(
  subsystems: readonly KnowledgeSubsystem[],
): Map<string, { x: number; y: number; r: number }> {
  const positions = new Map<string, { x: number; y: number; r: number }>()
  const count = subsystems.length
  subsystems.forEach((subsystem, index) => {
    const angle = (2 * Math.PI * index) / count - Math.PI / 2
    const x = count === 1 ? CENTER : CENTER + RADIUS * Math.cos(angle)
    const y = count === 1 ? CENTER : CENTER + RADIUS * Math.sin(angle)
    const r = clamp(10 + subsystem.paths.length * 1.5, 10, 26)
    positions.set(subsystem.name, { x, y, r })
  })
  return positions
}

export function DependencyGraph({
  subsystems,
  graph,
}: {
  readonly subsystems: readonly KnowledgeSubsystem[]
  readonly graph: SubsystemDependencyGraph
}) {
  if (graph.cycleStatus === 'unavailable') {
    return (
      <p className="text-sm text-muted-foreground">
        Enable GitNexus indexing for this repository to see its dependency
        graph.
      </p>
    )
  }
  if (graph.edges.length === 0 && graph.cycles.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No cross-subsystem imports detected.
      </p>
    )
  }

  const positions = layoutNodes(subsystems)
  const cycleSubsystems = new Set(
    graph.cycles.flatMap((cycle) => cycle.subsystems),
  )
  const maxWeight = Math.max(1, ...graph.edges.map((edge) => edge.weight))
  const shownCycles = graph.cycles.slice(0, 5)
  const hiddenCycleCount = graph.cycles.length - shownCycles.length

  return (
    <div className="space-y-3">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="mx-auto h-auto w-full max-w-[360px]"
        role="img"
        aria-label="Subsystem dependency graph"
      >
        <defs>
          <marker
            id="dependency-graph-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill="var(--muted-foreground)" />
          </marker>
        </defs>
        {graph.edges.map((edge) => {
          const from = positions.get(edge.source)
          const to = positions.get(edge.target)
          if (!from || !to) return null
          const strokeWidth = clamp((edge.weight / maxWeight) * 3, 1, 4)
          return (
            <line
              key={`${edge.source}->${edge.target}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke="var(--muted-foreground)"
              strokeOpacity={0.45}
              strokeWidth={strokeWidth}
              markerEnd="url(#dependency-graph-arrow)"
            >
              <title>
                {edge.source} → {edge.target} ({edge.weight} import
                {edge.weight === 1 ? '' : 's'})
              </title>
            </line>
          )
        })}
        {subsystems.map((subsystem, index) => {
          const position = positions.get(subsystem.name)
          if (!position) return null
          const inCycle = cycleSubsystems.has(subsystem.name)
          return (
            <g key={subsystem.name}>
              <circle
                cx={position.x}
                cy={position.y}
                r={position.r}
                fill={CHART_COLORS[index % CHART_COLORS.length]}
                fillOpacity={0.85}
                stroke={inCycle ? 'var(--color-destructive)' : 'var(--border)'}
                strokeWidth={inCycle ? 2.5 : 1}
              >
                <title>
                  {subsystem.name}: {subsystem.responsibility}
                </title>
              </circle>
              <text
                x={position.x}
                y={position.y + position.r + 12}
                textAnchor="middle"
                className="fill-foreground text-[9px]"
              >
                {subsystem.name.length > 18
                  ? `${subsystem.name.slice(0, 17)}…`
                  : subsystem.name}
              </text>
            </g>
          )
        })}
      </svg>
      {shownCycles.length > 0 ? (
        <div className="space-y-1 text-xs">
          <p className="font-semibold text-destructive-text">
            Import cycles
            {graph.componentCount !== null
              ? ` (${graph.componentCount} circular component${graph.componentCount === 1 ? '' : 's'})`
              : ''}
          </p>
          <ul className="space-y-1">
            {shownCycles.map((cycle) => (
              <li key={cycle.files.join('|')} className="truncate">
                <code className="text-muted-foreground">
                  {cycle.files.join(' → ')}
                </code>
              </li>
            ))}
          </ul>
          {hiddenCycleCount > 0 ? (
            <p className="text-muted-foreground">
              +{hiddenCycleCount} more cycle{hiddenCycleCount === 1 ? '' : 's'}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
