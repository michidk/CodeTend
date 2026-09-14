import { describe, expect, test } from 'bun:test'
import { listGitHubRepositoriesWithToken } from '@/lib/server/github-repositories.server'

const repository = {
  full_name: 'example/private-repo',
  clone_url: 'https://github.com/example/private-repo.git',
  default_branch: 'develop',
  private: true,
  archived: false,
}

describe('available GitHub repositories', () => {
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
})
