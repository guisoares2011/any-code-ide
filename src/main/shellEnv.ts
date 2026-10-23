import { execFile } from 'node:child_process'

/** Brackets the `env -0` dump so banners printed by the user's rc files are ignored. */
const MARK = '__ANYCODE_SHELL_ENV__'
const RESOLVE_TIMEOUT_MS = 10_000

/** Variables that describe the probe shell itself, not the user's environment. */
const SKIPPED = new Set(['_', 'PWD', 'OLDPWD', 'SHLVL', 'ANYCODE_RESOLVING_SHELL_ENV'])

/** Parses the output of `printf MARK; env -0; printf MARK`. */
export function parseShellEnv(output: string): Record<string, string> {
  const start = output.indexOf(MARK)
  const end = output.lastIndexOf(MARK)
  if (start < 0 || end <= start) return {}
  const env: Record<string, string> = {}
  for (const entry of output.slice(start + MARK.length, end).split('\0')) {
    const eq = entry.indexOf('=')
    if (eq <= 0) continue
    const key = entry.slice(0, eq)
    if (!SKIPPED.has(key)) env[key] = entry.slice(eq + 1)
  }
  return env
}

/**
 * Launched from the Dock or Finder, the app gets launchd's minimal environment (PATH=/usr/bin:/bin…),
 * and `$SHELL -l` alone skips `.zshrc`, where tools like `claude` (~/.local/bin) are usually added.
 * Like VS Code, an interactive login shell is asked for its environment once at startup.
 */
export function launchedOutsideTerminal(env: NodeJS.ProcessEnv): boolean {
  return !env.TERM && !env.TERM_PROGRAM
}

export function resolveShellEnv(shell: string): Promise<Record<string, string>> {
  return new Promise((resolve) => {
    execFile(
      shell,
      ['-i', '-l', '-c', `printf '%s' '${MARK}'; /usr/bin/env -0; printf '%s' '${MARK}'`],
      { env: { ...process.env, ANYCODE_RESOLVING_SHELL_ENV: '1' }, timeout: RESOLVE_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        if (error && !stdout) console.error('[anycode] could not read the login shell environment:', error.message)
        resolve(parseShellEnv(stdout ?? ''))
      },
    )
  })
}

/** Merges the user's shell environment into process.env, so terminals, LSPs and builds see their PATH. */
export async function adoptShellEnv(shell: string): Promise<void> {
  if (!launchedOutsideTerminal(process.env)) return
  for (const [key, value] of Object.entries(await resolveShellEnv(shell))) {
    if (!key.startsWith('ELECTRON_')) process.env[key] = value
  }
}
