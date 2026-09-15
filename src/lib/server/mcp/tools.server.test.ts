import { describe, expect, test } from 'bun:test'
import { createMcpHandler } from '@modelcontextprotocol/server'
import {
  createCodeTendMcpServer,
  type McpLoaders,
  type McpToolAccess,
} from './tools.server'

function handlers(loaders: McpLoaders, access?: McpToolAccess) {
  return createMcpHandler(() => createCodeTendMcpServer(loaders, access))
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
    triggerScan: async () => ({ scanId: 42 }),
    cancelScan: async () => ({ scanId: 42 }),
  }
}

describe('CodeTend MCP tools', () => {
  test('a read token only discovers bounded read tools', async () => {
    const message = await call(handlers(fakeLoaders()), 'tools/list', {})
    expect(
      message.result.tools.map((tool: { name: string }) => tool.name),
    ).toEqual([
      'list_repositories',
      'get_repository',
      'list_scans',
      'get_scan',
      'get_finding',
    ])
    expect(
      message.result.tools.every(
        (tool: { annotations: { readOnlyHint: boolean } }) =>
          tool.annotations.readOnlyHint,
      ),
    ).toBe(true)
  })

  test('write tools require their scope and preserve structured output', async () => {
    const handler = handlers(fakeLoaders(), {
      scopes: ['codetend:read', 'codetend:write'],
    })
    const listed = await call(handler, 'tools/list', {})
    expect(
      listed.result.tools.map((tool: { name: string }) => tool.name),
    ).toContain('trigger_scan')

    const triggered = await call(handler, 'tools/call', {
      name: 'trigger_scan',
      arguments: { repositoryId: 7 },
    })
    expect(triggered.result.structuredContent).toEqual({ scanId: 42 })
  })

  test('owner policy can hide an otherwise scoped tool', async () => {
    const handler = handlers(fakeLoaders(), {
      scopes: ['codetend:read', 'codetend:write'],
      enabledTools: ['list_repositories'],
    })
    const listed = await call(handler, 'tools/list', {})
    expect(
      listed.result.tools.map((tool: { name: string }) => tool.name),
    ).toEqual(['list_repositories'])
  })
})
