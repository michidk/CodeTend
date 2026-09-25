/**
 * The app and the Eve runtime share TECDEBT_DATA_DIR on the same host. The
 * app writes scan requests, Eve clones repositories into workspaces and writes
 * results back. The sandbox mounts `workspaces/` read-only at /workspace/repos.
 *
 * This module is imported by the workflow body, so it must stay free of
 * Node.js builtins; callers resolve paths inside "use step" functions.
 */
export function dataDir(): string {
  const configured = process.env.TECDEBT_DATA_DIR ?? '../data'
  return configured.replace(/\/+$/, '')
}

export const workspacesDir = () => `${dataDir()}/workspaces`
export const gitnexusRepositoriesDir = () =>
  `${dataDir()}/gitnexus-repositories`
export const requestsDir = () => `${dataDir()}/requests`
export const resultsDir = () => `${dataDir()}/results`
export const gitnexusHome = () => `${dataDir()}/gitnexus`
export const usageDir = () => `${dataDir()}/usage`

export function patchWorkspaceName(
  repositoryId: number,
  patchId: number,
): string {
  return `repo-${repositoryId}-patch-${patchId}`
}

export function workspaceName(repositoryId: number, scanId: number): string {
  return `repo-${repositoryId}-scan-${scanId}`
}

export function gitnexusRepositoryName(repositoryId: number): string {
  return `repo-${repositoryId}`
}

/** Path of a workspace as seen from inside the sandbox. */
export function sandboxRepoPath(name: string): string {
  return `/workspace/repos/${name}`
}
