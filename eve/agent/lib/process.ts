interface CommandResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

export async function run(
  command: string,
  args: readonly string[],
  options: {
    cwd?: string
    env?: Record<string, string>
    timeoutMs?: number
  } = {},
): Promise<CommandResult> {
  'use step'
  const { spawn } = await import('node:child_process')
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    const timer = options.timeoutMs
      ? setTimeout(() => child.kill('SIGKILL'), options.timeoutMs)
      : undefined
    child.once('error', (error) => {
      if (timer) clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code) => {
      if (timer) clearTimeout(timer)
      resolvePromise({ exitCode: code ?? -1, stdout, stderr })
    })
  })
}

export function assertOk(result: CommandResult, what: string): void {
  if (result.exitCode !== 0) {
    throw new Error(
      `${what} failed (exit ${result.exitCode}): ${(result.stderr || result.stdout).slice(-2000)}`,
    )
  }
}
