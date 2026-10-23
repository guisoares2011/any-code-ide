import { randomUUID } from 'node:crypto'
import { spawn, type IPty } from '@lydell/node-pty'
import type { WebContents } from 'electron'
import type { PtyCreateOptions } from '@shared/ipc'
import { emit, handle } from './ipc'
import { assertInsideProject } from './project'

interface Session {
  pty: IPty
  owner: WebContents
  pending: string
  flushScheduled: boolean
}

const sessions = new Map<string, Session>()

/** Time the foreground job gets to exit after ^C before its process group is killed. */
const STOP_GRACE_MS = 3000

/** Interrupts like ^C in a terminal, then SIGKILLs the session's process group if it lingers. */
export function stopPty(id: string): void {
  const session = sessions.get(id)
  if (!session) return
  session.pty.write('\x03')
  const { pid } = session.pty
  setTimeout(() => {
    if (sessions.get(id) !== session) return
    try {
      // The pty child is a session leader, so its pid is the process group id.
      process.kill(-pid, 'SIGKILL')
    } catch {
      session.pty.kill('SIGKILL')
    }
  }, STOP_GRACE_MS)
}

/**
 * Environment for terminal processes: the app's environment without Claude Code session markers
 * (CLAUDECODE, CLAUDE_CODE_*) that leak in when AnyCode itself was launched from a Claude session,
 * plus the terminal settings and `extra` (the IDE bridge variables).
 */
export function terminalEnv(base: NodeJS.ProcessEnv, extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined || key === 'CLAUDECODE' || key.startsWith('CLAUDE_CODE_')) continue
    env[key] = value
  }
  return { ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'AnyCode', ...extra }
}

/** POSIX single-quote escaping for one shell word. */
export function shellQuote(word: string): string {
  return /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`
}

/**
 * Login shell invocation: interactive shell, `exec <command>`, or a script; always through the login
 * shell so the user's PATH setup (mvn, node, claude...) applies.
 */
export function shellInvocation(shell: string, command: readonly string[] | undefined, script?: string): { file: string; args: string[] } {
  if (script) return { file: shell, args: ['-l', '-c', script] }
  if (!command || command.length === 0) return { file: shell, args: ['-l'] }
  return { file: shell, args: ['-l', '-c', `exec ${command.map(shellQuote).join(' ')}`] }
}

function flush(id: string): void {
  const session = sessions.get(id)
  if (!session) return
  session.flushScheduled = false
  if (session.pending) {
    emit(session.owner, 'pty:data', id, session.pending)
    session.pending = ''
  }
}

export function createPty(owner: WebContents, options: PtyCreateOptions, extraEnv: Record<string, string> = {}): string {
  const cwd = assertInsideProject(options.cwd)
  const { file, args } = shellInvocation(process.env.SHELL ?? '/bin/zsh', options.command, options.script)
  const pty = spawn(file, args, {
    name: 'xterm-256color',
    cols: options.cols,
    rows: options.rows,
    cwd,
    env: terminalEnv(process.env, { ...extraEnv, ...options.env }),
  })
  const id = randomUUID()
  const session: Session = { pty, owner, pending: '', flushScheduled: false }
  sessions.set(id, session)
  // Coalesce bursts of output into one IPC message per tick.
  pty.onData((data) => {
    session.pending += data
    if (!session.flushScheduled) {
      session.flushScheduled = true
      setImmediate(() => flush(id))
    }
  })
  pty.onExit(({ exitCode, signal }) => {
    flush(id)
    sessions.delete(id)
    emit(owner, 'pty:exit', { id, exitCode, signal: signal ?? null })
  })
  return id
}

export function killAllPtys(): void {
  for (const [id, session] of sessions) {
    session.pty.kill()
    sessions.delete(id)
  }
}

export function registerPtyHandlers(getOwner: () => WebContents | null, envFor: () => Record<string, string>): void {
  handle('pty:create', (options) => {
    const owner = getOwner()
    if (!owner) throw new Error('No window to attach the terminal to')
    return createPty(owner, options, envFor())
  })
  handle('pty:write', (id, data) => {
    sessions.get(id)?.pty.write(data)
  })
  handle('pty:resize', (id, cols, rows) => {
    sessions.get(id)?.pty.resize(Math.max(cols, 1), Math.max(rows, 1))
  })
  handle('pty:kill', (id) => {
    sessions.get(id)?.pty.kill()
  })
  handle('pty:stop', (id) => stopPty(id))
}
