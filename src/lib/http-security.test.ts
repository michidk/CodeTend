import { describe, expect, test } from 'bun:test'
import { withSecurityHeaders } from './http-security'

describe('HTTP security boundary', () => {
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
