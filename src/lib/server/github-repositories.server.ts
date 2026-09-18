import '@tanstack/react-start/server-only'

import type { ServerEnv } from '@/lib/env.server'
import { getServerEnv } from '@/lib/env.server'
import {
  createGitHubAppJwt,
  GITHUB_API_URL,
  type GitHubAppCredentials,
  type GitHubRepositoryResponse,
  getGitHubInstallationToken,
  githubHeaders,
  githubInstallationListSchema,
  githubRepositoryPageSchema,
  githubRequest,
  readGitHubAppCredentials,
} from '@/lib/github-app-auth'

const PAGE_SIZE = 100
const MAX_PAGES = 10

export interface AvailableGitHubRepository {
  readonly name: string
  readonly url: string
  readonly branch: string
  readonly private: boolean
  readonly archived: boolean
}

class GitHubApiError extends Error {
  constructor(readonly status: number) {
    super(`GitHub repository request failed (${status})`)
  }
}

export async function listGitHubRepositoriesWithApp(
  credentials: GitHubAppCredentials,
  request: typeof fetch = fetch,
): Promise<AvailableGitHubRepository[]> {
  const installationIds = await listAppInstallationIds(
    credentials.appId,
    credentials.privateKey,
    request,
  )
  const repositoryGroups = await Promise.all(
    installationIds.map(async (installationId) => {
      const token = await getGitHubInstallationToken(
        credentials,
        installationId,
        { request },
      )
      return fetchPages('/installation/repositories', token, request)
    }),
  )
  const uniqueRepositories = new Map<string, GitHubRepositoryResponse>()
  for (const repository of repositoryGroups.flat()) {
    uniqueRepositories.set(repository.full_name, repository)
  }
  return toAvailableRepositories([...uniqueRepositories.values()])
}

function appCredentials(env: ServerEnv) {
  return readGitHubAppCredentials({
    GITHUB_APP_ID: env.GITHUB_APP_ID,
    GITHUB_APP_PRIVATE_KEY: env.GITHUB_APP_PRIVATE_KEY,
  })
}

async function listAppInstallationIds(
  appId: string,
  privateKey: string,
  request: typeof fetch = fetch,
): Promise<string[]> {
  const jwt = createGitHubAppJwt({ appId, privateKey })
  const installationIds: string[] = []
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const response = await githubRequest(
      request,
      `${GITHUB_API_URL}/app/installations?per_page=${PAGE_SIZE}&page=${page}`,
      { headers: githubHeaders(jwt) },
    )
    if (!response.ok) {
      throw new Error(
        `GitHub App installation request failed (${response.status})`,
      )
    }
    const rows = githubInstallationListSchema.parse(await response.json())
    installationIds.push(...rows.map((row) => String(row.id)))
    if (rows.length < PAGE_SIZE) break
  }
  return installationIds
}

async function fetchPages(
  path: string,
  token: string,
  request: typeof fetch = fetch,
): Promise<GitHubRepositoryResponse[]> {
  const repositories: GitHubRepositoryResponse[] = []
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const separator = path.includes('?') ? '&' : '?'
    const response = await githubRequest(
      request,
      `${GITHUB_API_URL}${path}${separator}per_page=${PAGE_SIZE}&page=${page}`,
      { headers: githubHeaders(token) },
    )
    if (!response.ok) {
      throw new GitHubApiError(response.status)
    }
    const body = githubRepositoryPageSchema.parse(await response.json())
    const pageRows = Array.isArray(body) ? body : body.repositories
    repositories.push(...pageRows)
    if (pageRows.length < PAGE_SIZE) break
  }
  return repositories
}

function toAvailableRepositories(
  rows: readonly GitHubRepositoryResponse[],
): AvailableGitHubRepository[] {
  return rows
    .filter((repository) => !repository.archived)
    .map((repository) => ({
      name: repository.full_name,
      url: repository.clone_url,
      branch: repository.default_branch,
      private: repository.private,
      archived: repository.archived,
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

/** Supports either an installation token or a user/fine-grained token. */
export async function listGitHubRepositoriesWithToken(
  token: string,
  request: typeof fetch = fetch,
): Promise<AvailableGitHubRepository[]> {
  let rows: GitHubRepositoryResponse[]
  try {
    rows = await fetchPages('/installation/repositories', token, request)
  } catch (error) {
    if (
      !(error instanceof GitHubApiError) ||
      ![403, 404].includes(error.status)
    ) {
      throw error
    }
    rows = await fetchPages(
      '/user/repos?affiliation=owner,collaborator,organization_member&sort=full_name',
      token,
      request,
    )
  }
  return toAvailableRepositories(rows)
}

/** Lists repositories visible to the configured GitHub App or token. */
export async function listAvailableGitHubRepositories(): Promise<{
  readonly configured: boolean
  readonly repositories: AvailableGitHubRepository[]
}> {
  const env = getServerEnv()
  const credentials = appCredentials(env)

  if (credentials) {
    return {
      configured: true,
      repositories: await listGitHubRepositoriesWithApp(credentials),
    }
  } else if (env.GITHUB_TOKEN) {
    return {
      configured: true,
      repositories: await listGitHubRepositoriesWithToken(env.GITHUB_TOKEN),
    }
  } else {
    return { configured: false, repositories: [] }
  }
}
