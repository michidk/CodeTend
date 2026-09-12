import '@tanstack/react-start/server-only'

import { createEnv, type StandardSchemaV1 } from '@t3-oss/env-core'
import { createServerOnlyFn } from '@tanstack/react-start'
import { z } from 'zod'

const optionalString = z.string().trim().min(1).optional()

const booleanString = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1')

const serverSchema = {
  DATABASE_URL: z.string().trim().min(1),
  TECDEBT_DATA_DIR: z.string().trim().min(1).default('./data'),
  TECDEBT_ALLOWED_GIT_HOSTS: z.string().trim().min(1).default('github.com'),
  TECDEBT_ALLOW_LOCAL_REPOSITORIES: booleanString.default(false),
  TECDEBT_ALLOW_INSECURE_GIT: booleanString.default(false),
  TECDEBT_MAX_ACTIVE_SCANS: z.coerce.number().int().min(1).max(32).default(2),
  TECDEBT_MAX_ACTIVE_PATCHES: z.coerce.number().int().min(1).max(32).default(1),
  TECDEBT_MAX_DAILY_COST_USD: z.coerce.number().positive().optional(),
  TECDEBT_DEFAULT_SCAN_COST_USD: z.coerce.number().positive().optional(),
  TECDEBT_DEEP_WORKERS: z.coerce.number().int().min(1).max(4).default(2),
  TECDEBT_DEEP_MAX_RUNS: z.coerce.number().int().min(1).max(12).default(6),
  TECDEBT_DEEP_STOP_AFTER_NO_NEW: z.coerce
    .number()
    .int()
    .min(1)
    .max(6)
    .default(2),
  TECDEBT_VALIDATION_ENABLED: booleanString.default(false),
  TECDEBT_VALIDATION_RUNNER: z
    .enum(['auto', 'docker', 'disabled'])
    .default('auto'),
  TECDEBT_VALIDATION_IMAGE: z
    .string()
    .trim()
    .min(1)
    .default('node:24-bookworm-slim'),
  TECDEBT_MANUAL_SCAN_COOLDOWN_SECONDS: z.coerce
    .number()
    .int()
    .min(0)
    .max(86_400)
    .default(60),
  EVE_URL: z.url().default('http://127.0.0.1:2000'),
  EVE_USERNAME: z.string().trim().min(1).default('tecdebt'),
  EVE_PASSWORD: optionalString,
  SCHEDULER_INTERVAL_SECONDS: z.coerce.number().int().min(5).default(30),
  GITNEXUS_ENABLED: booleanString.default(false),
  GITNEXUS_MCP_PORT: z.coerce.number().int().min(1).max(65535).default(3907),
  TECDEBT_MODEL: z.string().trim().min(1).default('gpt-5.6-sol'),
}

type RuntimeEnvironment = Record<string, string | undefined>

function issueVariable(issue: StandardSchemaV1.Issue): string | undefined {
  const segment = issue.path?.[0]
  if (typeof segment === 'string') return segment
  if (segment && typeof segment === 'object') return String(segment.key)
  return undefined
}

function validationError(issues: readonly StandardSchemaV1.Issue[]): never {
  const variables = issues
    .map(issueVariable)
    .filter((variable): variable is string => Boolean(variable))

  if (variables.includes('DATABASE_URL')) {
    throw new Error('DATABASE_URL environment variable is required')
  }

  const details = issues
    .map((issue) => {
      const variable = issueVariable(issue)
      return variable ? `${variable}: ${issue.message}` : issue.message
    })
    .join('; ')

  throw new Error(`Invalid environment configuration: ${details}`)
}

export function parseServerEnv(runtimeEnvironment: RuntimeEnvironment) {
  return createEnv({
    server: serverSchema,
    runtimeEnvStrict: {
      DATABASE_URL: runtimeEnvironment.DATABASE_URL,
      TECDEBT_DATA_DIR: runtimeEnvironment.TECDEBT_DATA_DIR,
      TECDEBT_ALLOWED_GIT_HOSTS: runtimeEnvironment.TECDEBT_ALLOWED_GIT_HOSTS,
      TECDEBT_ALLOW_LOCAL_REPOSITORIES:
        runtimeEnvironment.TECDEBT_ALLOW_LOCAL_REPOSITORIES,
      TECDEBT_ALLOW_INSECURE_GIT: runtimeEnvironment.TECDEBT_ALLOW_INSECURE_GIT,
      TECDEBT_MAX_ACTIVE_SCANS: runtimeEnvironment.TECDEBT_MAX_ACTIVE_SCANS,
      TECDEBT_MAX_ACTIVE_PATCHES: runtimeEnvironment.TECDEBT_MAX_ACTIVE_PATCHES,
      TECDEBT_MAX_DAILY_COST_USD: runtimeEnvironment.TECDEBT_MAX_DAILY_COST_USD,
      TECDEBT_DEFAULT_SCAN_COST_USD:
        runtimeEnvironment.TECDEBT_DEFAULT_SCAN_COST_USD,
      TECDEBT_DEEP_WORKERS: runtimeEnvironment.TECDEBT_DEEP_WORKERS,
      TECDEBT_DEEP_MAX_RUNS: runtimeEnvironment.TECDEBT_DEEP_MAX_RUNS,
      TECDEBT_DEEP_STOP_AFTER_NO_NEW:
        runtimeEnvironment.TECDEBT_DEEP_STOP_AFTER_NO_NEW,
      TECDEBT_VALIDATION_ENABLED: runtimeEnvironment.TECDEBT_VALIDATION_ENABLED,
      TECDEBT_VALIDATION_RUNNER: runtimeEnvironment.TECDEBT_VALIDATION_RUNNER,
      TECDEBT_VALIDATION_IMAGE: runtimeEnvironment.TECDEBT_VALIDATION_IMAGE,
      TECDEBT_MANUAL_SCAN_COOLDOWN_SECONDS:
        runtimeEnvironment.TECDEBT_MANUAL_SCAN_COOLDOWN_SECONDS,
      EVE_URL: runtimeEnvironment.EVE_URL,
      EVE_USERNAME: runtimeEnvironment.EVE_USERNAME,
      EVE_PASSWORD: runtimeEnvironment.EVE_PASSWORD,
      SCHEDULER_INTERVAL_SECONDS: runtimeEnvironment.SCHEDULER_INTERVAL_SECONDS,
      GITNEXUS_ENABLED: runtimeEnvironment.GITNEXUS_ENABLED,
      GITNEXUS_MCP_PORT: runtimeEnvironment.GITNEXUS_MCP_PORT,
      TECDEBT_MODEL: runtimeEnvironment.TECDEBT_MODEL,
    },
    emptyStringAsUndefined: true,
    isServer: true,
    onValidationError: validationError,
  })
}

export type ServerEnv = ReturnType<typeof parseServerEnv>

let cachedEnvironment: ServerEnv | undefined

export const getServerEnv = createServerOnlyFn((): ServerEnv => {
  cachedEnvironment ??= parseServerEnv(process.env)
  return cachedEnvironment
})
