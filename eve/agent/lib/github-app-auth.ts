/**
 * Mints and caches GitHub App installation access tokens from
 * `GITHUB_APP_ID` / `GITHUB_APP_INSTALLATION_ID` / `GITHUB_APP_PRIVATE_KEY`.
 * Installation tokens are valid for one hour; the "hosting control plane"
 * that operates tecdebt does not need to rotate or feed in a token itself —
 * tecdebt mints its own from the App credentials, cached in-process and
 * refreshed ahead of expiry so a clone never races an expiring token.
 *
 * Only imported from "use step" functions (needs Node.js APIs).
 */

const REFRESH_BUFFER_MS = 5 * 60 * 1000
const GITHUB_API_URL = 'https://api.github.com'

let cached: { token: string; expiresAt: number } | undefined

export interface GitHubAppCredentials {
  readonly appId: string
  readonly installationId: string
  readonly privateKey: string
}

export function readGitHubAppCredentials(
  env: NodeJS.ProcessEnv = process.env,
): GitHubAppCredentials | null {
  const appId = env.GITHUB_APP_ID?.trim()
  const installationId = env.GITHUB_APP_INSTALLATION_ID?.trim()
  const privateKey = env.GITHUB_APP_PRIVATE_KEY?.trim()
  if (!appId || !installationId || !privateKey) return null
  return { appId, installationId, privateKey: normalizePrivateKey(privateKey) }
}

/** Accepts a PEM pasted with literal `\n` escapes as well as real newlines. */
function normalizePrivateKey(privateKey: string): string {
  return privateKey.includes('\n')
    ? privateKey
    : privateKey.replace(/\\n/g, '\n')
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url')
}

/**
 * GitHub rejects App JWTs older than 10 minutes; `iat` is backdated by a
 * minute to tolerate clock drift between this host and GitHub's servers.
 */
async function signAppJwt(credentials: GitHubAppCredentials): Promise<string> {
  const { sign } = await import('node:crypto')
  const nowSeconds = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = {
    iat: nowSeconds - 60,
    exp: nowSeconds + 570,
    iss: credentials.appId,
  }
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`
  const signature = sign(
    'RSA-SHA256',
    Buffer.from(signingInput),
    credentials.privateKey,
  )
  return `${signingInput}.${base64url(signature)}`
}

async function fetchInstallationToken(
  credentials: GitHubAppCredentials,
): Promise<{ token: string; expiresAt: number }> {
  const jwt = await signAppJwt(credentials)
  const response = await fetch(
    `${GITHUB_API_URL}/app/installations/${credentials.installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  )
  if (!response.ok) {
    throw new Error(
      `GitHub App installation token request failed with ${response.status}: ${await response.text()}`,
    )
  }
  const body = (await response.json()) as { token: string; expires_at: string }
  return { token: body.token, expiresAt: new Date(body.expires_at).getTime() }
}

/** Returns a cached installation token, minting a fresh one when needed. */
export async function getGitHubAppToken(
  credentials: GitHubAppCredentials,
): Promise<string> {
  if (cached && cached.expiresAt - REFRESH_BUFFER_MS > Date.now()) {
    return cached.token
  }
  cached = await fetchInstallationToken(credentials)
  return cached.token
}

/** Test-only: clears the module-level cache between cases. */
export function resetGitHubAppTokenCache(): void {
  cached = undefined
}
