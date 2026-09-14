/**
 * Repository access for clones. For github.com URLs, CodeTend prefers a
 * GitHub App installation token it mints and caches itself from
 * `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY`
 * (see `./github-app-auth.ts`), then a plain `GITHUB_TOKEN`, then the local
 * `gh` CLI (`gh auth git-credential`) when `gh` is logged in, otherwise the
 * credential helpers already configured for Git.
 *
 * Only imported from "use step" functions (needs Node.js APIs).
 */
import { getGitHubAppToken, readGitHubAppCredentials } from './github-app-auth'

const CREDENTIAL_TOKEN_ENV_VAR = 'TECDEBT_GIT_CREDENTIAL_TOKEN'

export interface GitAuth {
  /** Extra `git -c key=value` settings for the clone command. */
  readonly gitConfig: readonly string[]
  /** Merge into the spawned git process's environment, alongside gitConfig. */
  readonly env: Readonly<Record<string, string>>
  readonly source: 'github-app' | 'github-token' | 'gh-cli' | 'git-config'
}

export async function resolveGitAuth(repositoryUrl: string): Promise<GitAuth> {
  if (!/^https:\/\/([^/]*\.)?github\.com\//i.test(repositoryUrl)) {
    return { gitConfig: [], env: {}, source: 'git-config' }
  }
  const appCredentials = readGitHubAppCredentials()
  if (appCredentials) {
    const url = new URL(repositoryUrl)
    const [owner, repositoryWithSuffix] = url.pathname
      .replace(/^\//, '')
      .split('/')
    const repository = repositoryWithSuffix?.replace(/\.git$/, '')
    if (!owner || !repository) {
      throw new Error(`Invalid GitHub repository URL: ${repositoryUrl}`)
    }
    const token = await getGitHubAppToken(appCredentials, owner, repository)
    return { ...tokenGitAuth(token), source: 'github-app' }
  }
  if (process.env.GITHUB_TOKEN) {
    return { ...tokenGitAuth(process.env.GITHUB_TOKEN), source: 'github-token' }
  }
  const gh = await ghCliBinary()
  if (!gh) return { gitConfig: [], env: {}, source: 'git-config' }
  return {
    // Prepend gh as a credential helper; an empty helper entry first resets
    // the inherited helpers so gh is consulted before them.
    gitConfig: [
      'credential.https://github.com.helper=',
      `credential.https://github.com.helper=!${gh} auth git-credential`,
    ],
    env: {},
    source: 'gh-cli',
  }
}

/**
 * The token is carried through a dedicated environment variable on the
 * spawned git process and expanded there by the credential-helper
 * subprocess. It is never interpolated into the clone command's argv (which
 * `ps` can see) or logged by CodeTend.
 */
function tokenGitAuth(token: string): Pick<GitAuth, 'gitConfig' | 'env'> {
  return {
    gitConfig: [
      'credential.https://github.com.helper=',
      `credential.https://github.com.helper=!f() { test "$1" = get && echo username=x-access-token && echo "password=$${CREDENTIAL_TOKEN_ENV_VAR}"; }; f`,
    ],
    env: { [CREDENTIAL_TOKEN_ENV_VAR]: token },
  }
}

async function ghCliBinary(): Promise<string | null> {
  const { spawn } = await import('node:child_process')
  return new Promise((resolve) => {
    const child = spawn('gh', ['auth', 'status'], { stdio: 'ignore' })
    child.once('error', () => resolve(null))
    child.once('exit', (code) => resolve(code === 0 ? 'gh' : null))
  })
}
