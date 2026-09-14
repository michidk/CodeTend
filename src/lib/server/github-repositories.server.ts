import '@tanstack/react-start/server-only'

import { Buffer } from 'node:buffer'
import { sign } from 'node:crypto'
import type { ServerEnv } from '@/lib/env.server'
import { getServerEnv } from '@/lib/env.server'

const GITHUB_API_URL = 'https://api.github.com'
const REFRESH_BUFFER_MS = 5 * 60_000
const PAGE_SIZE = 100
const MAX_PAGES = 10

let cachedInstallationToken:
  | { readonly token: string; readonly expiresAt: number }
  | undefined

export interface AvailableGitHubRepository {
  readonly name: string
  readonly url: string
  readonly branch: string
  readonly private: boolean
  readonly archived: boolean
}

interface GitHubRepositoryResponse {
  readonly full_name: string
  readonly clone_url: string
  readonly default_branch: string
  readonly private: boolean
  readonly archived: boolean
}

class GitHubApiError extends Error {
  constructor(readonly status: number) {
    super(`GitHub repository request failed (${status})`)
  }
}

function normalizePrivateKey(value: string): string {
  return value.includes('\n') ? value : value.replace(/\\n/g, '\n')
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url')
}

function createAppJwt(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1_000)
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = base64url(
    JSON.stringify({ iat: now - 60, exp: now + 570, iss: appId }),
  )
  const input = `${header}.${payload}`
  const signature = sign(
    'RSA-SHA256',
    Buffer.from(input),
    normalizePrivateKey(privateKey),
  )
  return `${input}.${base64url(signature)}`
}

async function getInstallationToken(
  appId: string,
  installationId: string,
  privateKey: string,
): Promise<string> {
  if (
    cachedInstallationToken &&
    cachedInstallationToken.expiresAt - REFRESH_BUFFER_MS > Date.now()
  ) {
    return cachedInstallationToken.token
  }

  const response = await fetch(
    `${GITHUB_API_URL}/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: githubHeaders(createAppJwt(appId, privateKey)),
    },
  )
  if (!response.ok) {
    throw new Error(
      `GitHub installation authentication failed (${response.status})`,
    )
  }
  const body = (await response.json()) as {
    readonly token: string
    readonly expires_at: string
  }
  cachedInstallationToken = {
    token: body.token,
    expiresAt: new Date(body.expires_at).getTime(),
  }
  return body.token
}

function githubHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'CodeTend',
  }
}

function appCredentials(env: ServerEnv) {
  if (
    env.GITHUB_APP_ID &&
    env.GITHUB_APP_INSTALLATION_ID &&
    env.GITHUB_APP_PRIVATE_KEY
  ) {
    return {
      appId: env.GITHUB_APP_ID,
      installationId: env.GITHUB_APP_INSTALLATION_ID,
      privateKey: env.GITHUB_APP_PRIVATE_KEY,
    }
  }
  return null
}

async function fetchPages(
  path: string,
  token: string,
  request: typeof fetch = fetch,
): Promise<GitHubRepositoryResponse[]> {
  const repositories: GitHubRepositoryResponse[] = []
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const separator = path.includes('?') ? '&' : '?'
    const response = await request(
      `${GITHUB_API_URL}${path}${separator}per_page=${PAGE_SIZE}&page=${page}`,
      { headers: githubHeaders(token) },
    )
    if (!response.ok) {
      throw new GitHubApiError(response.status)
    }
    const body = (await response.json()) as
      | GitHubRepositoryResponse[]
      | { readonly repositories: GitHubRepositoryResponse[] }
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
    const token = await getInstallationToken(
      credentials.appId,
      credentials.installationId,
      credentials.privateKey,
    )
    const rows = await fetchPages('/installation/repositories', token)
    return { configured: true, repositories: toAvailableRepositories(rows) }
  } else if (env.GITHUB_TOKEN) {
    return {
      configured: true,
      repositories: await listGitHubRepositoriesWithToken(env.GITHUB_TOKEN),
    }
  } else {
    return { configured: false, repositories: [] }
  }
}
