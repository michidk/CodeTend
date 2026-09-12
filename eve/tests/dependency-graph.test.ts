import { describe, expect, test } from 'bun:test'
import {
  buildSubsystemDependencyGraph,
  parseCyclesReport,
  parseFileEdges,
  type SubsystemNode,
} from '../agent/lib/dependency-graph'

const subsystems: SubsystemNode[] = [
  { name: 'API', paths: ['src/routes'] },
  { name: 'Scan Pipeline', paths: ['eve/agent'] },
  { name: 'Database', paths: ['src/db'] },
]

describe('parseFileEdges', () => {
  test('parses a raw JSON row array', () => {
    const stdout = JSON.stringify([
      { source: 'src/routes/a.ts', target: 'eve/agent/steps.ts' },
      { source: 'not an edge' },
    ])
    expect(parseFileEdges(stdout)).toEqual([
      { source: 'src/routes/a.ts', target: 'eve/agent/steps.ts' },
    ])
  })

  test('returns empty array for non-array JSON', () => {
    expect(parseFileEdges('{}')).toEqual([])
  })
})

describe('parseCyclesReport', () => {
  test('parses a clean report', () => {
    expect(
      parseCyclesReport(
        JSON.stringify({ status: 'clean', componentCount: 0, cycles: [] }),
      ),
    ).toEqual({
      status: 'clean',
      componentCount: 0,
      cycles: [],
    })
  })

  test('parses a cycles_found report', () => {
    const stdout = JSON.stringify({
      status: 'cycles_found',
      componentCount: 2,
      cycles: [{ files: ['a.ts', 'b.ts'] }],
    })
    expect(parseCyclesReport(stdout)).toEqual({
      status: 'cycles_found',
      componentCount: 2,
      cycles: [{ files: ['a.ts', 'b.ts'] }],
    })
  })

  test('returns null for the total-failure shape', () => {
    expect(
      parseCyclesReport(JSON.stringify({ error: 'boom', truncated: true })),
    ).toBeNull()
  })
})

describe('buildSubsystemDependencyGraph', () => {
  test('returns unavailable when there are no subsystems', () => {
    expect(buildSubsystemDependencyGraph([], [], null).cycleStatus).toBe(
      'unavailable',
    )
  })

  test('maps files to subsystems by longest-prefix match and aggregates weights', () => {
    const graph = buildSubsystemDependencyGraph(
      subsystems,
      [
        { source: 'src/routes/a.ts', target: 'eve/agent/steps.ts' },
        { source: 'src/routes/b.ts', target: 'eve/agent/steps.ts' },
        { source: 'eve/agent/steps.ts', target: 'src/db/schema.ts' },
      ],
      null,
    )
    expect(graph.edges).toEqual([
      { source: 'API', target: 'Scan Pipeline', weight: 2 },
      { source: 'Scan Pipeline', target: 'Database', weight: 1 },
    ])
  })

  test('drops self-subsystem edges', () => {
    const graph = buildSubsystemDependencyGraph(
      subsystems,
      [{ source: 'src/routes/a.ts', target: 'src/routes/b.ts' }],
      null,
    )
    expect(graph.edges).toEqual([])
  })

  test('drops edges touching files that match no subsystem', () => {
    const graph = buildSubsystemDependencyGraph(
      subsystems,
      [{ source: 'src/routes/a.ts', target: 'scripts/build.ts' }],
      null,
    )
    expect(graph.edges).toEqual([])
  })

  test('handles multi-word subsystem names without corrupting the aggregation key', () => {
    const graph = buildSubsystemDependencyGraph(
      subsystems,
      [{ source: 'src/routes/a.ts', target: 'eve/agent/steps.ts' }],
      null,
    )
    expect(graph.edges).toEqual([
      { source: 'API', target: 'Scan Pipeline', weight: 1 },
    ])
  })

  test('caps edges at 200, keeping the highest-weight ones', () => {
    const many: SubsystemNode[] = Array.from({ length: 205 }, (_, i) => ({
      name: `S${i}`,
      paths: [`s${i}`],
    }))
    const edges = many.slice(0, 204).map((s, i) => ({
      source: `${s.paths[0]}/a.ts`,
      target: `${many[i + 1].paths[0]}/a.ts`,
    }))
    const graph = buildSubsystemDependencyGraph(many, edges, null)
    expect(graph.edges.length).toBe(200)
  })

  test('maps cycle files to subsystem names and dedupes/caps', () => {
    const cyclesReport = {
      status: 'cycles_found' as const,
      componentCount: 1,
      cycles: [
        { files: ['src/routes/a.ts', 'eve/agent/steps.ts', 'src/routes/a.ts'] },
        { files: ['src/routes/a.ts', 'eve/agent/steps.ts', 'src/routes/a.ts'] },
        { files: ['scripts/build.ts'] },
      ],
    }
    const graph = buildSubsystemDependencyGraph(subsystems, [], cyclesReport)
    expect(graph.cycleStatus).toBe('cycles_found')
    expect(graph.componentCount).toBe(1)
    expect(graph.cycles).toEqual([
      {
        files: ['src/routes/a.ts', 'eve/agent/steps.ts', 'src/routes/a.ts'],
        subsystems: ['API', 'Scan Pipeline'],
      },
    ])
  })

  test('cycleStatus is unavailable when cyclesReport is null', () => {
    const graph = buildSubsystemDependencyGraph(subsystems, [], null)
    expect(graph.cycleStatus).toBe('unavailable')
    expect(graph.componentCount).toBeNull()
  })
})
