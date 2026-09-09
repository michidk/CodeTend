/**
 * Repository access for clones. The PoC relies on the host's own Git/GitHub
 * setup: for github.com URLs it asks the local `gh` CLI for credentials
 * (`gh auth git-credential`) when `gh` is logged in, otherwise it falls back
 * to the credential helpers already configured for Git. A later version can
 * replace this with GitHub App installation tokens without touching the
 * clone step: return the token as `x-access-token:<token>` here.
 *
 * Only imported from "use step" functions (needs Node.js APIs).
 */
export interface GitAuth {
  /** Extra `git -c key=value` settings for the clone command. */
  readonly gitConfig: readonly string[]
  readonly source: 'gh-cli' | 'git-config'
}

export async function resolveGitAuth(repositoryUrl: string): Promise<GitAuth> {
  if (!/^https:\/\/([^/]*\.)?github\.com\//i.test(repositoryUrl)) {
    return { gitConfig: [], source: 'git-config' }
  }
  const gh = await ghCliBinary()
  if (!gh) return { gitConfig: [], source: 'git-config' }
  return {
    // Prepend gh as a credential helper; an empty helper entry first resets
    // the inherited helpers so gh is consulted before them.
    gitConfig: [
      'credential.https://github.com.helper=',
      `credential.https://github.com.helper=!${gh} auth git-credential`,
    ],
    source: 'gh-cli',
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
