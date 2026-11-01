import { describe, expect, test } from 'bun:test'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { MCP_TOOL_CATALOG, MCP_TOOL_NAMES } from '@/lib/mcp/catalog'
import { createCodeTendMcpServer, type McpLoaders } from './tools.server'

function handlers(
  loaders: McpLoaders,
  policy?: Parameters<typeof createCodeTendMcpServer>[1],
) {
  return createMcpHandler(() => createCodeTendMcpServer(loaders, policy))
}

async function call(
  handler: ReturnType<typeof handlers>,
  method: string,
  params: Record<string, unknown>,
) {
  const response = await handler.fetch(
    new Request('http://localhost/api/mcp', {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
  )
  expect(response.status).toBe(200)
  const data = (await response.text())
    .split('\n')
    .find((line) => line.startsWith('data: '))
    ?.slice(6)
  if (!data) throw new Error('MCP response did not contain an SSE data event')
  return JSON.parse(data)
}

function fakeLoaders(): McpLoaders {
  return {
    listRepositories: async ({ offset, limit }) => ({
      repositories: [],
      total: 0,
      offset,
      limit,
      hasMore: false,
    }),
    getRepository: async () => ({ repository: null }),
    listScans: async ({ offset, limit }) => ({
      scans: [],
      total: 0,
      offset,
      limit,
      hasMore: false,
    }),
    getScan: async () => ({ scan: null }),
    getFinding: async () => ({ finding: null }),
    generateFixPrompt: async (repositoryId, scannerId) => ({
      repositoryId,
      scannerId,
      findingCount: 2,
      prompt: '# Fix findings',
    }),
    registerRepository: async ({ url, name, branch, scheduleEnabled }) => ({
      repositoryId: 3,
      name: name ?? 'octo/demo',
      url,
      branch,
      scheduleEnabled,
    }),
    triggerScan: async () => ({ scanId: 42 }),
    cancelScan: async () => ({ scanId: 42 }),
    markFindingFixed: async (findingId) => ({
      finding: { id: findingId, state: 'resolved', disposition: null },
    }),
    markFindingFalsePositive: async (findingId) => ({
      finding: {
        id: findingId,
        state: 'resolved',
        disposition: 'false_positive',
      },
    }),
    acceptFindingRisk: async (findingId) => ({
      finding: {
        id: findingId,
        state: 'resolved',
        disposition: 'accepted_risk',
      },
    }),
    reopenFinding: async (findingId) => ({
      finding: { id: findingId, state: 'active', disposition: null },
    }),
  }
}

describe('CodeTend MCP tools', () => {
  test('discovers every tool, with read tools annotated read-only', async () => {
    const message = await call(handlers(fakeLoaders()), 'tools/list', {})
    expect(
      message.result.tools.map((tool: { name: string }) => tool.name).sort(),
    ).toEqual([...MCP_TOOL_NAMES].sort())
    expect(
      message.result.tools
        .filter((tool: { name: string }) =>
          MCP_TOOL_CATALOG.some(
            (entry) => entry.name === tool.name && entry.group === 'Read',
          ),
        )
        .every(
          (tool: { annotations: { readOnlyHint: boolean } }) =>
            tool.annotations.readOnlyHint,
        ),
    ).toBe(true)

    const repositoryTool = message.result.tools.find(
      (tool: { name: string }) => tool.name === 'get_repository',
    )
    expect(repositoryTool.outputSchema.properties.repository).toBeDefined()
    expect(repositoryTool.outputSchema.additionalProperties).toBe(false)
  })

  test('write tools preserve structured output', async () => {
    const handler = handlers(fakeLoaders())
    const listed = await call(handler, 'tools/list', {})
    expect(
      listed.result.tools.map((tool: { name: string }) => tool.name),
    ).toEqual(expect.arrayContaining(['trigger_scan', 'mark_finding_fixed']))

    const triggered = await call(handler, 'tools/call', {
      name: 'trigger_scan',
      arguments: { repositoryId: 7 },
    })
    expect(triggered.result.structuredContent).toEqual({ scanId: 42 })

    const fixed = await call(handler, 'tools/call', {
      name: 'mark_finding_fixed',
      arguments: { findingId: 8, note: 'Updated the affected call site.' },
    })
    expect(fixed.result.structuredContent).toEqual({
      finding: { id: 8, state: 'resolved', disposition: null },
    })

    const triaged = await call(handler, 'tools/call', {
      name: 'mark_finding_false_positive',
      arguments: { findingId: 9, note: 'Confirmed generated fixture.' },
    })
    expect(triaged.result.structuredContent).toEqual({
      finding: {
        id: 9,
        state: 'resolved',
        disposition: 'false_positive',
      },
    })
  })

  test('registers a repository with defaults', async () => {
    const registered = await call(handlers(fakeLoaders()), 'tools/call', {
      name: 'register_repository',
      arguments: { url: 'https://github.com/octo/demo' },
    })
    expect(registered.result.structuredContent).toEqual({
      repositoryId: 3,
      name: 'octo/demo',
      url: 'https://github.com/octo/demo',
      branch: 'main',
      scheduleEnabled: true,
    })
  })

  test('marking a finding fixed requires meaningful context', async () => {
    const message = await call(handlers(fakeLoaders()), 'tools/call', {
      name: 'mark_finding_fixed',
      arguments: { findingId: 8, note: 'ok' },
    })

    expect(message.result.isError).toBe(true)
    expect(message.result.content[0]?.text).toContain('note')
  })

  test('generates a bounded fix prompt ', async () => {
    const generated = await call(handlers(fakeLoaders()), 'tools/call', {
      name: 'generate_fix_prompt',
      arguments: { repositoryId: 7, scannerId: 'architecture' },
    })
    expect(generated.result.structuredContent).toEqual({
      repositoryId: 7,
      scannerId: 'architecture',
      findingCount: 2,
      prompt: '# Fix findings',
    })
  })

  test('owner policy hides disabled tools and audits calls', async () => {
    const audits: unknown[] = []
    const all = Object.keys(
      Object.fromEntries(
        (
          await call(handlers(fakeLoaders()), 'tools/list', {})
        ).result.tools.map((tool: { name: string }) => [tool.name, 1]),
      ),
    )
    const handler = handlers(fakeLoaders(), {
      disabledTools: new Set(
        all.filter((name) => name !== 'list_repositories'),
      ),
      audit: async (event) => void audits.push(event),
    })
    const listed = await call(handler, 'tools/list', {})
    expect(
      listed.result.tools.map((tool: { name: string }) => tool.name),
    ).toEqual(['list_repositories'])
    await call(handler, 'tools/call', {
      name: 'list_repositories',
      arguments: {},
    })
    expect(audits).toEqual([
      {
        event: 'tool_called',
        toolName: 'list_repositories',
        outcome: 'success',
      },
    ])
  })
})
