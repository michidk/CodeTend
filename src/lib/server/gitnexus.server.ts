import '@tanstack/react-start/server-only'

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { getServerEnv } from '@/lib/env.server'
import { gitnexusHome } from '@/lib/server/scan-files.server'

let serverStarting: Promise<boolean> | undefined

async function isHealthy(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(2_000),
    })
    return response.ok
  } catch {
    return false
  }
}

/**
 * Starts the GitNexus MCP HTTP server on loopback once per app process and
 * reports whether it is reachable. Indexing itself happens inside the Eve
 * pipeline; the server picks up newly registered repositories automatically.
 * Any failure degrades to "no GitNexus" because it is enrichment only.
 */
export async function ensureGitNexusServer(): Promise<boolean> {
  const env = getServerEnv()
  if (!env.GITNEXUS_ENABLED) return false
  if (await isHealthy(env.GITNEXUS_MCP_PORT)) return true
  serverStarting ??= startServer(env.GITNEXUS_MCP_PORT).finally(() => {
    serverStarting = undefined
  })
  return serverStarting
}

async function startServer(port: number): Promise<boolean> {
  try {
    await mkdir(gitnexusHome(), { recursive: true })
    const child = spawn(
      resolveGitNexusBinary(),
      ['mcp', '--http', '--port', String(port), '--host', '127.0.0.1'],
      {
        env: {
          ...process.env,
          GITNEXUS_HOME: gitnexusHome(),
          GITNEXUS_NO_UPDATE_NOTIFIER: '1',
          GITNEXUS_MCP_READ_ONLY: '1',
          GITNEXUS_LBUG_EXTENSION_INSTALL: 'load-only',
        },
        stdio: 'ignore',
        detached: true,
      },
    )
    child.unref()
    child.once('error', (error) => {
      console.warn(
        `[tecdebt] GitNexus MCP server failed to start: ${error.message}`,
      )
    })
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1_000))
      if (await isHealthy(port)) return true
    }
    console.warn(
      '[tecdebt] GitNexus MCP server did not become healthy; continuing without it',
    )
    return false
  } catch (error) {
    console.warn(
      `[tecdebt] GitNexus unavailable: ${error instanceof Error ? error.message : String(error)}`,
    )
    return false
  }
}

/**
 * `npm i -g gitnexus` installs into a prefix that is not always on PATH for a
 * service process, so probe the common global-bin locations as well.
 */
function resolveGitNexusBinary(): string {
  const candidates = [
    process.env.GITNEXUS_BIN,
    resolve('.tools/node_modules/.bin/gitnexus'),
    `${homedir()}/.local/bin/gitnexus`,
    '/usr/local/bin/gitnexus',
    '/usr/bin/gitnexus',
  ].filter((candidate): candidate is string => Boolean(candidate))
  return candidates.find((candidate) => existsSync(candidate)) ?? 'gitnexus'
}
