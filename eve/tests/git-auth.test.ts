import { afterEach, describe, expect, test } from 'bun:test'
import { generateKeyPairSync } from 'node:crypto'
import { resolveGitAuth } from '../agent/lib/git-auth'
import { resetGitHubAppTokenCache } from '../agent/lib/github-app-auth'

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

const ENV_KEYS = [
  'GITHUB_APP_ID',
  'GITHUB_APP_INSTALLATION_ID',
  'GITHUB_APP_PRIVATE_KEY',
  'GITHUB_TOKEN',
] as const

function clearAuthEnv() {
  for (const key of ENV_KEYS) delete process.env[key]
}

afterEach(() => {
  clearAuthEnv()
  resetGitHubAppTokenCache()
})

describe('resolveGitAuth', () => {
  test('never touches auth for non-github hosts', async () => {
    process.env.GITHUB_TOKEN = 'should-be-ignored'
    const auth = await resolveGitAuth('https://gitlab.com/example/repo.git')
    expect(auth).toEqual({ gitConfig: [], env: {}, source: 'git-config' })
  })

  test('prefers a minted GitHub App installation token over a plain token', async () => {
    process.env.GITHUB_APP_ID = '123'
    process.env.GITHUB_APP_INSTALLATION_ID = '456'
    process.env.GITHUB_APP_PRIVATE_KEY = privateKey
    process.env.GITHUB_TOKEN = 'plain-token-should-lose'
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          token: 'ghs_app_token',
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        }),
        { status: 200 },
      )) as typeof fetch

    try {
      const auth = await resolveGitAuth('https://github.com/example/repo.git')
      expect(auth.source).toBe('github-app')
      expect(auth.env).toEqual({
        TECDEBT_GIT_CREDENTIAL_TOKEN: 'ghs_app_token',
      })
      // The token itself never appears in the git-config argv (visible to
      // `ps`) — only a reference to the environment variable that carries it.
      expect(auth.gitConfig.join('\n')).not.toContain('ghs_app_token')
      expect(auth.gitConfig.join('\n')).toContain(
        '$TECDEBT_GIT_CREDENTIAL_TOKEN',
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('falls back to a plain GITHUB_TOKEN when no App is configured', async () => {
    process.env.GITHUB_TOKEN = 'plain-token'
    const auth = await resolveGitAuth('https://github.com/example/repo.git')
    expect(auth.source).toBe('github-token')
    expect(auth.env).toEqual({ TECDEBT_GIT_CREDENTIAL_TOKEN: 'plain-token' })
    expect(auth.gitConfig.join('\n')).not.toContain('plain-token')
  })
})
