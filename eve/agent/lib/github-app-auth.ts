/** GitHub App repository-installation lookup for Eve clone credentials. */
import {
  createGitHubAppJwt,
  GITHUB_API_URL,
  type GitHubAppCredentials,
  getGitHubInstallationToken,
  githubHeaders,
  githubInstallationSchema,
  githubRequest,
  readGitHubAppCredentials as readSharedGitHubAppCredentials,
  resetGitHubInstallationTokenCache,
} from '../../../src/lib/github-app-auth'

export type { GitHubAppCredentials }

export function readGitHubAppCredentials(
  env: Record<string, string | undefined> = process.env,
): GitHubAppCredentials | null {
  return readSharedGitHubAppCredentials(env)
}

async function resolveInstallationId(
  credentials: GitHubAppCredentials,
  owner: string,
  repository: string,
  request: typeof fetch,
  signal?: AbortSignal,
): Promise<string> {
  const response = await githubRequest(
    request,
    `${GITHUB_API_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/installation`,
    {
      headers: githubHeaders(createGitHubAppJwt(credentials)),
      signal,
    },
  )
  if (!response.ok) {
    throw new Error(
      `GitHub App installation lookup failed for ${owner}/${repository} with ${response.status}: ${await response.text()}`,
    )
  }
  return String(githubInstallationSchema.parse(await response.json()).id)
}

/** Resolves and returns a cached installation token for one repository. */
export async function getGitHubAppToken(
  credentials: GitHubAppCredentials,
  owner: string,
  repository: string,
  options: {
    readonly request?: typeof fetch
    readonly signal?: AbortSignal
  } = {},
): Promise<string> {
  const request = options.request ?? fetch
  const installationId = await resolveInstallationId(
    credentials,
    owner,
    repository,
    request,
    options.signal,
  )
  return getGitHubInstallationToken(credentials, installationId, {
    request,
    signal: options.signal,
  })
}

/** Test-only: clears the shared module cache between cases. */
export function resetGitHubAppTokenCache(): void {
  resetGitHubInstallationTokenCache()
}
