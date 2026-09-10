import { describe, expect, test } from 'bun:test'
import {
  hasValidBasicAuthorization,
  independentlyAuthenticatedPath,
  withSecurityHeaders,
} from './http-security'

describe('HTTP security boundary', () => {
  test('accepts the configured Basic credentials only', () => {
    const valid = `Basic ${Buffer.from('operator:correct').toString('base64')}`
    expect(
      hasValidBasicAuthorization(
        new Request('https://example.test', {
          headers: { authorization: valid },
        }),
        'operator',
        'correct',
      ),
    ).toBe(true)
    expect(
      hasValidBasicAuthorization(
        new Request('https://example.test', {
          headers: { authorization: `${valid}x` },
        }),
        'operator',
        'correct',
      ),
    ).toBe(false)
  })

  test('exempts only health and the signed webhook endpoint', () => {
    expect(independentlyAuthenticatedPath('/api/health')).toBe(true)
    expect(independentlyAuthenticatedPath('/api/health/')).toBe(true)
    expect(independentlyAuthenticatedPath('/api/webhooks/github')).toBe(true)
    expect(independentlyAuthenticatedPath('/api/webhooks/github/')).toBe(true)
    expect(
      independentlyAuthenticatedPath('/api/webhooks/github/anything'),
    ).toBe(false)
    expect(independentlyAuthenticatedPath('/')).toBe(false)
  })

  test('sets browser hardening headers and HSTS only for HTTPS', () => {
    const secure = withSecurityHeaders(
      new Response('ok'),
      new Request('https://example.test'),
    )
    expect(secure.headers.get('x-frame-options')).toBe('DENY')
    expect(secure.headers.get('x-content-type-options')).toBe('nosniff')
    expect(secure.headers.get('strict-transport-security')).toContain(
      'max-age=31536000',
    )

    const local = withSecurityHeaders(
      new Response('ok'),
      new Request('http://127.0.0.1'),
    )
    expect(local.headers.get('strict-transport-security')).toBeNull()
  })
})
