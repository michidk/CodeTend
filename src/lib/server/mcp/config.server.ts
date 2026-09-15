import '@tanstack/react-start/server-only'

import { getServerEnv } from '@/lib/env.server'
import { MCP_SCOPE_VALUES } from '@/lib/mcp/catalog'

export const MCP_READ_SCOPE = MCP_SCOPE_VALUES[0]

export type McpConfig = {
  serverUrl: URL
  issuer: URL
  signingSecret: string
  allowedHostnames: string[]
  allowedOrigins: string[]
  dangerouslyAllowInsecureUrls: boolean
}

type McpEnvironment = {
  MCP_ALLOWED_ORIGINS?: string
  HODOR_SECRET?: string
}

type ApplicationUrl = string | URL | Request

function isLoopback(url: URL) {
  return ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)
}

function requireSecureUrl(url: URL) {
  if (
    url.protocol === 'https:' ||
    (url.protocol === 'http:' && isLoopback(url))
  ) {
    return
  }

  throw new Error('MCP requires HTTPS unless the app is running on localhost')
}

export function resolveMcpConfig(
  environment: McpEnvironment,
  applicationUrl: ApplicationUrl,
): McpConfig {
  if (!environment.HODOR_SECRET || environment.HODOR_SECRET.length < 32) {
    throw new Error('HODOR_SECRET must be at least 32 characters for MCP')
  }

  const applicationOrigin = resolveApplicationUrl(applicationUrl).origin
  const serverUrl = new URL('/api/mcp', applicationOrigin)
  requireSecureUrl(serverUrl)

  const allowedOrigins = environment.MCP_ALLOWED_ORIGINS?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => new URL(origin).origin)

  return {
    serverUrl,
    issuer: new URL('/', serverUrl),
    signingSecret: environment.HODOR_SECRET,
    allowedHostnames: [serverUrl.hostname],
    allowedOrigins: allowedOrigins ?? [],
    dangerouslyAllowInsecureUrls: isLoopback(serverUrl),
  }
}

function firstForwardedValue(value: string | null) {
  return value?.split(',')[0]?.trim()
}

function resolveApplicationUrl(applicationUrl: ApplicationUrl) {
  if (!(applicationUrl instanceof Request)) return new URL(applicationUrl)

  const requestUrl = new URL(applicationUrl.url)
  const forwardedProtocol = firstForwardedValue(
    applicationUrl.headers.get('x-forwarded-proto'),
  )
  const protocol =
    forwardedProtocol === 'http' || forwardedProtocol === 'https'
      ? `${forwardedProtocol}:`
      : requestUrl.protocol
  const host =
    firstForwardedValue(applicationUrl.headers.get('x-forwarded-host')) ??
    applicationUrl.headers.get('host') ??
    requestUrl.host

  return new URL(`${protocol}//${host}`)
}

export function getMcpConfig(applicationUrl: ApplicationUrl) {
  return resolveMcpConfig(getServerEnv(), applicationUrl)
}
