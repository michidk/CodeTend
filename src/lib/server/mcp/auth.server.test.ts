import { describe, expect, test } from 'bun:test'
import { hasValidOwnerSession } from './auth.server'

function requestWith(headers: Record<string, string>) {
  return new Request('https://example.test', { headers })
}

describe('Hodor owner session verification', () => {
  test('accepts the authentication methods Hodor gates on', () => {
    expect(
      hasValidOwnerSession(requestWith({ 'X-Hodor-Auth': 'password' })),
    ).toBe(true)
    expect(
      hasValidOwnerSession(requestWith({ 'X-Hodor-Auth': 'bypass' })),
    ).toBe(true)
  })

  test('rejects a request Hodor served without authenticating anyone', () => {
    // A public path is reached by machines that never log in, so it must not
    // pass as the owner approving an OAuth client.
    expect(
      hasValidOwnerSession(requestWith({ 'X-Hodor-Auth': 'public' })),
    ).toBe(false)
  })

  test('rejects a request that did not come through Hodor', () => {
    expect(hasValidOwnerSession(requestWith({}))).toBe(false)
    expect(hasValidOwnerSession(requestWith({ 'X-Hodor-Auth': '' }))).toBe(
      false,
    )
    expect(
      hasValidOwnerSession(requestWith({ 'X-Hodor-Auth': 'PASSWORD' })),
    ).toBe(false)
    expect(
      hasValidOwnerSession(requestWith({ 'X-Hodor-Auth': 'password, bypass' })),
    ).toBe(false)
  })

  test('ignores a session cookie, which Hodor no longer speaks for', () => {
    expect(
      hasValidOwnerSession(requestWith({ Cookie: 'hodor=9999999999|abc' })),
    ).toBe(false)
  })
})
