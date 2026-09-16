import { afterEach, describe, expect, test } from 'bun:test'
import { createGitHubPullRequest } from '../agent/lib/github-pull-request'

const originalFetch = globalThis.fetch
const originalToken = process.env.GITHUB_TOKEN
const originalAppId = process.env.GITHUB_APP_ID
const originalPrivateKey = process.env.GITHUB_APP_PRIVATE_KEY

afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalToken === undefined) delete process.env.GITHUB_TOKEN
  else process.env.GITHUB_TOKEN = originalToken
  if (originalAppId === undefined) delete process.env.GITHUB_APP_ID
  else process.env.GITHUB_APP_ID = originalAppId
  if (originalPrivateKey === undefined)
    delete process.env.GITHUB_APP_PRIVATE_KEY
  else process.env.GITHUB_APP_PRIVATE_KEY = originalPrivateKey
})

describe('createGitHubPullRequest', () => {
  test('creates a pull request with the configured repository token', async () => {
    process.env.GITHUB_TOKEN = 'test-token'
    delete process.env.GITHUB_APP_ID
    delete process.env.GITHUB_APP_PRIVATE_KEY
    let request: { url: string; init?: RequestInit } | undefined
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      request = { url: String(url), init }
      return Response.json({
        html_url: 'https://github.com/example/repo/pull/42',
        number: 42,
      })
    }) as typeof fetch

    const result = await createGitHubPullRequest({
      repositoryUrl: 'https://github.com/example/repo.git',
      base: 'main',
      head: 'codetend/finding-1-patch-2',
      title: 'fix: close the gap',
      body: 'Details',
    })

    expect(result).toEqual({
      url: 'https://github.com/example/repo/pull/42',
      number: 42,
      branch: 'codetend/finding-1-patch-2',
    })
    expect(request?.url).toBe('https://api.github.com/repos/example/repo/pulls')
    expect(request?.init?.method).toBe('POST')
    expect(request?.init?.headers).toMatchObject({
      Authorization: 'Bearer test-token',
    })
    expect(JSON.parse(String(request?.init?.body))).toMatchObject({
      base: 'main',
      head: 'codetend/finding-1-patch-2',
    })
  })

  test('rejects repositories outside github.com before making a request', async () => {
    process.env.GITHUB_TOKEN = 'test-token'
    delete process.env.GITHUB_APP_ID
    delete process.env.GITHUB_APP_PRIVATE_KEY
    await expect(
      createGitHubPullRequest({
        repositoryUrl: 'https://git.example.com/example/repo',
        base: 'main',
        head: 'fix',
        title: 'fix: issue',
        body: 'Details',
      }),
    ).rejects.toThrow('only supported for github.com')
  })
})
