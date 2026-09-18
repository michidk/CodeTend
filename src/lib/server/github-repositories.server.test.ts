import { describe, expect, test } from 'bun:test'
import { generateKeyPairSync } from 'node:crypto'
import {
  listGitHubRepositoriesWithApp,
  listGitHubRepositoriesWithToken,
} from '@/lib/server/github-repositories.server'

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

const repository = {
  full_name: 'example/private-repo',
  clone_url: 'https://github.com/example/private-repo.git',
  default_branch: 'develop',
  private: true,
  archived: false,
}

describe('available GitHub repositories', () => {
  test('combines repositories from every GitHub App installation', async () => {
    const request = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = String(input)
      if (url.includes('/app/installations?')) {
        return Response.json([{ id: 10 }, { id: 20 }])
      }
      if (url.endsWith('/app/installations/10/access_tokens')) {
        return Response.json({
          token: 'token-10',
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        })
      }
      if (url.endsWith('/app/installations/20/access_tokens')) {
        return Response.json({
          token: 'token-20',
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        })
      }
      const authorization = new Headers(init?.headers).get('Authorization')
      return Response.json({
        repositories: [
          {
            ...repository,
            full_name:
              authorization === 'Bearer token-10'
                ? 'first/private-repo'
                : 'second/private-repo',
          },
        ],
      })
    }) as typeof fetch

    const result = await listGitHubRepositoriesWithApp(
      { appId: '123', privateKey },
      request,
    )

    expect(result.map((row) => row.name)).toEqual([
      'first/private-repo',
      'second/private-repo',
    ])
  })

  test('reads repositories from an installation token', async () => {
    const urls: string[] = []
    const request = (async (input: string | URL | Request) => {
      urls.push(String(input))
      return Response.json({
        repositories: [
          repository,
          {
            ...repository,
            full_name: 'example/archived-repo',
            archived: true,
          },
        ],
      })
    }) as typeof fetch

    const result = await listGitHubRepositoriesWithToken('token', request)

    expect(urls).toHaveLength(1)
    expect(urls[0]).toContain('/installation/repositories?')
    expect(result).toEqual([
      {
        name: 'example/private-repo',
        url: 'https://github.com/example/private-repo.git',
        branch: 'develop',
        private: true,
        archived: false,
      },
    ])
  })

  test('hides archived repositories', async () => {
    const request = (async (_input: string | URL | Request) =>
      Response.json([
        repository,
        {
          ...repository,
          full_name: 'example/archived-repo',
          archived: true,
        },
      ])) as typeof fetch

    const result = await listGitHubRepositoriesWithToken('token', request)

    expect(result.map((row) => row.name)).toEqual(['example/private-repo'])
  })

  test('falls back to user repositories for a non-installation token', async () => {
    const urls: string[] = []
    const request = (async (input: string | URL | Request) => {
      const url = String(input)
      urls.push(url)
      if (url.includes('/installation/repositories')) {
        return new Response(null, { status: 403 })
      }
      return Response.json([repository])
    }) as typeof fetch

    const result = await listGitHubRepositoriesWithToken('token', request)

    expect(urls).toHaveLength(2)
    expect(urls[1]).toContain('/user/repos?')
    expect(result[0]?.name).toBe('example/private-repo')
  })

  test('rejects malformed repository pages', async () => {
    const request = (async (_input: string | URL | Request) =>
      Response.json({
        repositories: [{ ...repository, clone_url: 'file:///tmp/repo' }],
      })) as typeof fetch

    await expect(
      listGitHubRepositoriesWithToken('token', request),
    ).rejects.toThrow()
  })

  test('rejects malformed App installation records', async () => {
    const request = (async (_input: string | URL | Request) =>
      Response.json([{ id: 'not-a-number' }])) as typeof fetch

    await expect(
      listGitHubRepositoriesWithApp({ appId: '123', privateKey }, request),
    ).rejects.toThrow()
  })
})
