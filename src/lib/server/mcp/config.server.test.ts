import { describe, expect, test } from 'bun:test'
import { getMcpEndpoint, resolveMcpConfig } from './config.server'

describe('MCP configuration', () => {
  test('defaults to loopback and adds configured hosts and origins by hostname', () => {
    expect(resolveMcpConfig({})).toEqual({
      allowedHostnames: ['localhost', '127.0.0.1', '[::1]'],
      allowedOrigins: ['localhost', '127.0.0.1', '[::1]'],
    })
    const config = resolveMcpConfig({
      MCP_ALLOWED_HOSTS: 'Codetend-Mcp, codetend-mcp.default.svc',
      MCP_ALLOWED_ORIGINS: 'https://chatgpt.com/path, example.test',
    })
    expect(config.allowedHostnames).toContain('codetend-mcp')
    expect(config.allowedHostnames).toContain('codetend-mcp.default.svc')
    expect(config.allowedOrigins).toContain('chatgpt.com')
    expect(config.allowedOrigins).toContain('example.test')
  })

  test('derives the displayed endpoint from forwarded request headers', () => {
    const request = new Request('http://internal:3000/settings/mcp', {
      headers: {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'codetend.example.com, proxy',
      },
    })
    expect(getMcpEndpoint(request).href).toBe(
      'https://codetend.example.com/api/mcp',
    )
  })
})
