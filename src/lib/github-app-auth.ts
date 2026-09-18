import { Buffer } from 'node:buffer'
import { sign } from 'node:crypto'
import { z } from 'zod'

export const GITHUB_API_URL = 'https://api.github.com'
export const GITHUB_REQUEST_TIMEOUT_MS = 15_000
const REFRESH_BUFFER_MS = 5 * 60_000

export interface GitHubAppCredentials {
  readonly appId: string
  readonly privateKey: string
}

export const githubInstallationSchema = z.object({ id: z.number().int() })
export const githubInstallationListSchema = z.array(githubInstallationSchema)
export const githubInstallationTokenSchema = z.object({
  token: z.string().min(1),
  expires_at: z.iso.datetime(),
})
export const githubRepositorySchema = z.object({
  full_name: z.string().min(1),
  clone_url: z.url().refine((url) => url.startsWith('https://github.com/'), {
    message: 'Expected a GitHub HTTPS clone URL',
  }),
  default_branch: z.string().min(1),
  private: z.boolean(),
  archived: z.boolean(),
})
export const githubRepositoryPageSchema = z.union([
  z.array(githubRepositorySchema),
  z.object({ repositories: z.array(githubRepositorySchema) }),
])
export type GitHubRepositoryResponse = z.infer<typeof githubRepositorySchema>

const cachedTokens = new Map<
  string,
  { readonly token: string; readonly expiresAt: number }
>()

export function readGitHubAppCredentials(
  env: Record<string, string | undefined> = process.env,
): GitHubAppCredentials | null {
  const appId = env.GITHUB_APP_ID?.trim()
  const privateKey = env.GITHUB_APP_PRIVATE_KEY?.trim()
  if (!appId || !privateKey) return null
  return { appId, privateKey: normalizePrivateKey(privateKey) }
}

/** Accepts a PEM pasted with literal `\n` escapes as well as real newlines. */
export function normalizePrivateKey(privateKey: string): string {
  return privateKey.includes('\n')
    ? privateKey
    : privateKey.replace(/\\n/g, '\n')
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url')
}

/** Signs a short-lived App JWT, backdated to tolerate clock drift. */
export function createGitHubAppJwt(
  credentials: GitHubAppCredentials,
  now: () => number = Date.now,
): string {
  const nowSeconds = Math.floor(now() / 1_000)
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = base64url(
    JSON.stringify({
      iat: nowSeconds - 60,
      exp: nowSeconds + 570,
      iss: credentials.appId,
    }),
  )
  const signingInput = `${header}.${payload}`
  const signature = sign(
    'RSA-SHA256',
    Buffer.from(signingInput),
    normalizePrivateKey(credentials.privateKey),
  )
  return `${signingInput}.${base64url(signature)}`
}

export function githubHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'CodeTend',
  }
}

/** Applies a bounded deadline while preserving caller cancellation. */
export async function githubRequest(
  request: typeof fetch,
  input: string | URL | Request,
  init: RequestInit = {},
  timeoutMs = GITHUB_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const timeout = AbortSignal.timeout(timeoutMs)
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout
  try {
    return await request(input, { ...init, signal })
  } catch (error) {
    if (timeout.aborted && !init.signal?.aborted) {
      throw new Error(`GitHub request timed out after ${timeoutMs}ms`, {
        cause: error,
      })
    }
    throw error
  }
}

export async function getGitHubInstallationToken(
  credentials: GitHubAppCredentials,
  installationId: string,
  options: {
    readonly request?: typeof fetch
    readonly now?: () => number
    readonly signal?: AbortSignal
  } = {},
): Promise<string> {
  const request = options.request ?? fetch
  const now = options.now ?? Date.now
  const cacheKey = `${credentials.appId}:${installationId}`
  const cached = cachedTokens.get(cacheKey)
  if (cached && cached.expiresAt - REFRESH_BUFFER_MS > now()) {
    return cached.token
  }

  const response = await githubRequest(
    request,
    `${GITHUB_API_URL}/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: githubHeaders(createGitHubAppJwt(credentials, now)),
      signal: options.signal,
    },
  )
  if (!response.ok) {
    throw new Error(
      `GitHub installation authentication failed (${response.status})`,
    )
  }
  const body = githubInstallationTokenSchema.parse(await response.json())
  const expiresAt = Date.parse(body.expires_at)
  if (!Number.isFinite(expiresAt)) {
    throw new Error('GitHub returned an invalid installation-token expiry')
  }
  cachedTokens.set(cacheKey, { token: body.token, expiresAt })
  return body.token
}

/** Test-only: clears process-local installation tokens between cases. */
export function resetGitHubInstallationTokenCache(): void {
  cachedTokens.clear()
}
