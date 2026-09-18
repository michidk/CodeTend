import { describe, expect, test } from 'bun:test'
import { generateKeyPairSync } from 'node:crypto'
import {
  getGitHubInstallationToken,
  githubRequest,
  resetGitHubInstallationTokenCache,
} from './github-app-auth'

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

describe('GitHub API boundary', () => {
  test('rejects malformed installation-token responses', async () => {
    resetGitHubInstallationTokenCache()
    const request = (async (_input: string | URL | Request) =>
      Response.json({ token: '', expires_at: 'not-a-date' })) as typeof fetch

    await expect(
      getGitHubInstallationToken({ appId: '123', privateKey }, '456', {
        request,
      }),
    ).rejects.toThrow()
  })

  test('caches a valid installation token until its refresh window', async () => {
    resetGitHubInstallationTokenCache()
    let calls = 0
    const now = Date.now()
    const request = (async (_input: string | URL | Request) => {
      calls += 1
      return Response.json({
        token: 'ghs_valid',
        expires_at: new Date(now + 3_600_000).toISOString(),
      })
    }) as typeof fetch
    const credentials = { appId: '123', privateKey }

    expect(
      await getGitHubInstallationToken(credentials, '456', {
        request,
        now: () => now,
      }),
    ).toBe('ghs_valid')
    expect(
      await getGitHubInstallationToken(credentials, '456', {
        request,
        now: () => now + 1_000,
      }),
    ).toBe('ghs_valid')
    expect(calls).toBe(1)
    resetGitHubInstallationTokenCache()
  })

  test('reports its deadline distinctly from caller cancellation', async () => {
    const request = ((_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(init.signal?.reason),
        )
      })) as typeof fetch

    await expect(
      githubRequest(request, 'https://api.github.com', {}, 1),
    ).rejects.toThrow('GitHub request timed out after 1ms')

    const controller = new AbortController()
    const pending = githubRequest(
      request,
      'https://api.github.com',
      { signal: controller.signal },
      60_000,
    )
    controller.abort(new Error('caller stopped'))
    await expect(pending).rejects.toThrow('caller stopped')
  })
})
