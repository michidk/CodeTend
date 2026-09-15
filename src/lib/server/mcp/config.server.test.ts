import { describe, expect, test } from 'bun:test'
import { resolveMcpConfig } from './config.server'

describe('MCP configuration', () => {
  test('derives the endpoint and issuer from the application URL', () => {
    expect(
      resolveMcpConfig(
        {
          HODOR_SECRET: 'x'.repeat(64),
          MCP_ALLOWED_ORIGINS: 'https://chatgpt.com, https://example.test/path',
        },
        'https://codetend.example.com/settings/mcp?tab=tools',
      ),
    ).toMatchObject({
      serverUrl: new URL('https://codetend.example.com/api/mcp'),
      issuer: new URL('https://codetend.example.com/'),
      allowedOrigins: ['https://chatgpt.com', 'https://example.test'],
    })
  })

  test('requires owner-session verification and a secure application URL', () => {
    expect(() =>
      resolveMcpConfig({}, 'https://codetend.example.com/settings/mcp'),
    ).toThrow('HODOR_SECRET')
    expect(() =>
      resolveMcpConfig(
        { HODOR_SECRET: 'x'.repeat(64) },
        'http://codetend.example.com/settings/mcp',
      ),
    ).toThrow('HTTPS')
  })

  test('allows local HTTP development', () => {
    expect(
      resolveMcpConfig(
        { HODOR_SECRET: 'x'.repeat(64) },
        'http://localhost:3000/settings/mcp',
      ).serverUrl.toString(),
    ).toBe('http://localhost:3000/api/mcp')
  })

  test('uses the public origin forwarded by the application proxy', () => {
    const request = new Request('http://app:3000/api/mcp', {
      headers: {
        Host: 'app:3000',
        'X-Forwarded-Host': 'codetend.example.com',
        'X-Forwarded-Proto': 'https',
      },
    })
    expect(
      resolveMcpConfig(
        { HODOR_SECRET: 'x'.repeat(64) },
        request,
      ).serverUrl.toString(),
    ).toBe('https://codetend.example.com/api/mcp')
  })
})
