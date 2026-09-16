import { getGitHubAppToken, readGitHubAppCredentials } from './github-app-auth'

const GITHUB_API_URL = 'https://api.github.com'

export interface PullRequestReference {
  readonly url: string
  readonly number: number
  readonly branch: string
}

export async function createGitHubPullRequest(input: {
  readonly repositoryUrl: string
  readonly base: string
  readonly head: string
  readonly title: string
  readonly body: string
}): Promise<PullRequestReference> {
  const repository = parseGitHubRepository(input.repositoryUrl)
  const credentials = readGitHubAppCredentials()
  const token = credentials
    ? await getGitHubAppToken(
        credentials,
        repository.owner,
        repository.repository,
      )
    : process.env.GITHUB_TOKEN?.trim()
  if (!token) {
    throw new Error(
      'Opening a pull request requires GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY, or GITHUB_TOKEN.',
    )
  }

  const response = await fetch(
    `${GITHUB_API_URL}/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repository)}/pulls`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        title: input.title,
        body: input.body,
        head: input.head,
        base: input.base,
      }),
    },
  )
  if (!response.ok) {
    throw new Error(
      `GitHub pull request creation failed with ${response.status}: ${(await response.text()).slice(0, 2000)}`,
    )
  }
  const result = (await response.json()) as {
    html_url?: unknown
    number?: unknown
  }
  if (
    typeof result.html_url !== 'string' ||
    typeof result.number !== 'number'
  ) {
    throw new Error('GitHub returned an invalid pull request response.')
  }
  return {
    url: result.html_url,
    number: result.number,
    branch: input.head,
  }
}

function parseGitHubRepository(repositoryUrl: string): {
  owner: string
  repository: string
} {
  let url: URL
  try {
    url = new URL(repositoryUrl)
  } catch {
    throw new Error('Pull request creation requires an HTTPS GitHub URL.')
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname.toLowerCase() !== 'github.com'
  ) {
    throw new Error(
      'Pull request creation is only supported for github.com repositories.',
    )
  }
  const parts = url.pathname.replace(/^\//, '').split('/')
  const owner = parts[0]
  const repository = parts[1]?.replace(/\.git$/, '')
  if (!owner || !repository || parts.length !== 2) {
    throw new Error(`Invalid GitHub repository URL: ${repositoryUrl}`)
  }
  return { owner, repository }
}
