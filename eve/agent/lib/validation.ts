import type {
  CandidateValidation,
  ScanRequest,
  WorkspaceManifest,
} from './contract'
import { run } from './process'

interface ValidationCandidate {
  readonly scannerId: string
  readonly fingerprint: string
  readonly validationPlan?: {
    readonly method: string
    readonly commands: readonly {
      readonly command: string
      readonly purpose: string
      readonly timeoutSeconds: number
    }[]
  }
}

/**
 * Runs model-proposed reproduction commands in disposable, credential-free
 * Docker containers. The checkout is mounted read-only and copied into a
 * throwaway workspace; networking and Linux capabilities are disabled.
 */
export async function validateCandidates(input: {
  readonly request: ScanRequest
  readonly workspace: WorkspaceManifest
  readonly candidates: readonly ValidationCandidate[]
}): Promise<CandidateValidation[]> {
  'use step'
  const candidates = input.candidates.slice(0, 12)
  if (candidates.length === 0) return []
  if (
    !input.request.validation.enabled ||
    input.request.validation.runner === 'disabled'
  ) {
    return candidates.map((candidate) =>
      unavailableValidation(candidate, 'disabled'),
    )
  }

  const docker = await run(
    'docker',
    ['version', '--format', '{{.Server.Version}}'],
    {
      timeoutMs: 15_000,
    },
  ).catch(() => null)
  if (docker?.exitCode !== 0) {
    return candidates.map((candidate) =>
      unavailableValidation(
        candidate,
        'Docker is unavailable; no unisolated fallback was attempted.',
      ),
    )
  }

  const results: CandidateValidation[] = []
  for (const candidate of candidates) {
    const validationPlan = candidate.validationPlan
    if (!validationPlan) {
      results.push({
        ...unavailableValidation(
          candidate,
          'No safe executable validation plan was provided.',
        ),
        status: 'not_run',
        method: 'static-review',
      })
      continue
    }
    results.push(
      await runCandidateValidation({
        candidate: { ...candidate, validationPlan },
        workspace: input.workspace,
        image: input.request.validation.image,
      }),
    )
  }
  return results
}

async function runCandidateValidation(input: {
  readonly candidate: ValidationCandidate & {
    readonly validationPlan: NonNullable<ValidationCandidate['validationPlan']>
  }
  readonly workspace: WorkspaceManifest
  readonly image: string
}): Promise<CandidateValidation> {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const started = Date.now()
  const scratch = await mkdtemp(join(tmpdir(), 'codetend-validation-'))
  let containerId = ''
  const commands: CandidateValidation['commands'][number][] = []
  try {
    const created = await run(
      'docker',
      [
        'create',
        '--network',
        'none',
        '--cap-drop',
        'ALL',
        '--security-opt',
        'no-new-privileges',
        '--pids-limit',
        '256',
        '--memory',
        '2g',
        '--cpus',
        '2',
        '--read-only',
        '--tmpfs',
        '/tmp:rw,noexec,nosuid,nodev,size=256m',
        '--mount',
        `type=bind,src=${input.workspace.hostPath},dst=/source,readonly`,
        '--mount',
        `type=bind,src=${scratch},dst=/workspace`,
        input.image,
        'sh',
        '-lc',
        'cp -a /source/. /workspace/ && exec sleep infinity',
      ],
      { timeoutMs: 2 * 60_000 },
    )
    if (created.exitCode !== 0) {
      return failedValidation(
        input.candidate,
        `Could not create the isolated validation container: ${trimOutput(created.stderr || created.stdout)}`,
      )
    }
    containerId = created.stdout.trim()
    const start = await run('docker', ['start', containerId], {
      timeoutMs: 2 * 60_000,
    })
    if (start.exitCode !== 0) {
      return failedValidation(
        input.candidate,
        `Could not start the isolated validation container: ${trimOutput(start.stderr || start.stdout)}`,
      )
    }

    for (const command of input.candidate.validationPlan.commands) {
      const commandStarted = Date.now()
      const result = await run(
        'docker',
        [
          'exec',
          '--workdir',
          '/workspace',
          containerId,
          'sh',
          '-lc',
          command.command,
        ],
        { timeoutMs: command.timeoutSeconds * 1_000 },
      )
      const timedOut = result.exitCode === -1
      commands.push({
        ...command,
        exitCode: timedOut ? null : result.exitCode,
        stdout: trimOutput(result.stdout),
        stderr: trimOutput(result.stderr),
        timedOut,
        durationMs: Date.now() - commandStarted,
      })
      if (timedOut || result.exitCode !== 0) break
    }

    const final = commands.at(-1)
    const allStepsRan =
      commands.length === input.candidate.validationPlan.commands.length
    const status = final?.timedOut
      ? 'inconclusive'
      : !allStepsRan
        ? 'inconclusive'
        : final?.exitCode === 0
          ? 'confirmed'
          : 'not_reproduced'
    return {
      scannerId: input.candidate.scannerId,
      fingerprint: input.candidate.fingerprint,
      status,
      method: input.candidate.validationPlan.method,
      summary:
        status === 'confirmed'
          ? 'The complete isolated validation plan exited successfully.'
          : status === 'not_reproduced'
            ? 'The reproducer completed but did not confirm the vulnerability.'
            : 'Validation could not reach a conclusive reproduction result.',
      commands,
      proofGaps:
        status === 'confirmed'
          ? []
          : [
              'The proposed executable validation did not conclusively reproduce the claimed vulnerable behavior.',
            ],
      runner: `docker:${input.image}`,
      validatedAt: new Date(started).toISOString(),
    }
  } catch (error) {
    return failedValidation(
      input.candidate,
      error instanceof Error ? error.message : String(error),
    )
  } finally {
    if (containerId) {
      await run('docker', ['rm', '--force', containerId], {
        timeoutMs: 30_000,
      }).catch(() => undefined)
    }
    await rm(scratch, { recursive: true, force: true })
  }
}

function unavailableValidation(
  candidate: ValidationCandidate,
  reason: string,
): CandidateValidation {
  return {
    scannerId: candidate.scannerId,
    fingerprint: candidate.fingerprint,
    status: 'unavailable',
    method: candidate.validationPlan?.method ?? 'static-review',
    summary: reason,
    commands: [],
    proofGaps: [reason],
    runner: 'none',
    validatedAt: new Date().toISOString(),
  }
}

function failedValidation(
  candidate: ValidationCandidate,
  reason: string,
): CandidateValidation {
  return {
    ...unavailableValidation(candidate, reason),
    status: 'error',
    runner: 'docker',
  }
}

function trimOutput(value: string): string {
  const limit = 16_000
  return value.length <= limit
    ? value
    : `${value.slice(0, limit)}\n[output truncated]`
}
