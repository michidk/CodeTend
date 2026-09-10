export interface RepositoryAccessPolicy {
  readonly allowedHosts: readonly string[]
  readonly allowLocal: boolean
  readonly allowInsecureHttp: boolean
}

/** Validates clone locations before they cross into the credentialed Eve host. */
export function validateRepositoryLocation(
  raw: string,
  policy: RepositoryAccessPolicy,
): string | null {
  if (raw.startsWith('/') || raw.startsWith('file://')) {
    return policy.allowLocal
      ? null
      : 'Local repository paths are disabled on this deployment.'
  }

  let host: string
  if (/^[^@/]+@[^:]+:.+/.test(raw)) {
    host = raw.slice(raw.indexOf('@') + 1, raw.indexOf(':')).toLowerCase()
  } else {
    let parsed: URL
    try {
      parsed = new URL(raw)
    } catch {
      return 'Enter a valid Git repository URL.'
    }
    if (!['https:', 'http:', 'ssh:'].includes(parsed.protocol)) {
      return 'Only HTTPS and SSH repository URLs are allowed.'
    }
    if (parsed.username || parsed.password) {
      return 'Do not put credentials in a repository URL.'
    }
    if (parsed.protocol === 'http:' && !policy.allowInsecureHttp) {
      return 'Plain HTTP repository URLs are disabled.'
    }
    host = parsed.hostname.toLowerCase()
  }

  const allowed = policy.allowedHosts
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
  if (!allowed.includes(host)) {
    return `Repository host ${host || '(missing)'} is not allowed.`
  }
  return null
}
