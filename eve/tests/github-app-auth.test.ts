import { describe, expect, test } from 'bun:test'
import { createPrivateKey, generateKeyPairSync, verify } from 'node:crypto'
import {
  getGitHubAppToken,
  readGitHubAppCredentials,
  resetGitHubAppTokenCache,
} from '../agent/lib/github-app-auth'

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const [, payload] = jwt.split('.')
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
}

function verifyJwtSignature(jwt: string): boolean {
  const [header, payload, signature] = jwt.split('.')
  return verify(
    'RSA-SHA256',
    Buffer.from(`${header}.${payload}`),
    createPrivateKey(privateKey),
    Buffer.from(signature, 'base64url'),
  )
}

describe('readGitHubAppCredentials', () => {
  test('requires all three fields together', () => {
    expect(
      readGitHubAppCredentials({
        GITHUB_APP_ID: '123',
        GITHUB_APP_INSTALLATION_ID: '456',
      }),
    ).toBeNull()
    expect(readGitHubAppCredentials({})).toBeNull()
  })

  test('normalizes a private key pasted with literal \\n escapes', () => {
    const escaped = privateKey.trim().replaceAll('\n', '\\n')
    const credentials = readGitHubAppCredentials({
      GITHUB_APP_ID: '123',
      GITHUB_APP_INSTALLATION_ID: '456',
      GITHUB_APP_PRIVATE_KEY: escaped,
    })
    expect(credentials?.privateKey).toBe(privateKey.trim())
  })

  test('leaves a private key with real newlines untouched', () => {
    const credentials = readGitHubAppCredentials({
      GITHUB_APP_ID: '123',
      GITHUB_APP_INSTALLATION_ID: '456',
      GITHUB_APP_PRIVATE_KEY: privateKey,
    })
    expect(credentials?.privateKey).toBe(privateKey.trim())
  })
})

describe('getGitHubAppToken', () => {
  test('signs a short-lived RS256 App JWT and caches the minted token', async () => {
    resetGitHubAppTokenCache()
    const requests: { url: string; authorization: string | null }[] = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      requests.push({
        url: String(url),
        authorization:
          (init?.headers as Record<string, string> | undefined)
            ?.Authorization ?? null,
      })
      return new Response(
        JSON.stringify({
          token: 'ghs_minted',
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        }),
        { status: 200 },
      )
    }) as typeof fetch

    try {
      const credentials = {
        appId: '123',
        installationId: '456',
        privateKey,
      }
      const token = await getGitHubAppToken(credentials)
      expect(token).toBe('ghs_minted')
      expect(requests).toHaveLength(1)
      expect(requests[0].url).toBe(
        'https://api.github.com/app/installations/456/access_tokens',
      )
      const jwt = requests[0].authorization?.replace('Bearer ', '') ?? ''
      const payload = decodeJwtPayload(jwt)
      expect(payload.iss).toBe('123')
      expect(
        (payload.exp as number) - (payload.iat as number),
      ).toBeLessThanOrEqual(630)
      expect(verifyJwtSignature(jwt)).toBe(true)

      // Second call within the token's lifetime reuses the cache.
      const cachedToken = await getGitHubAppToken(credentials)
      expect(cachedToken).toBe('ghs_minted')
      expect(requests).toHaveLength(1)
    } finally {
      globalThis.fetch = originalFetch
      resetGitHubAppTokenCache()
    }
  })

  test('raises a clear error when GitHub rejects the token request', async () => {
    resetGitHubAppTokenCache()
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response('installation not found', { status: 404 })) as typeof fetch

    try {
      await expect(
        getGitHubAppToken({ appId: '1', installationId: '2', privateKey }),
      ).rejects.toThrow(/404/)
    } finally {
      globalThis.fetch = originalFetch
      resetGitHubAppTokenCache()
    }
  })
})
