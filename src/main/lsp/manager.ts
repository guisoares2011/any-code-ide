// Language server processes: one per (project root, server), started on demand by the renderer,
// speaking LSP over stdio. Messages are relayed verbatim; the renderer owns the LSP client.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app, type WebContents } from 'electron'
import type { LanguageServerId } from '@shared/languageServers'
import { emit, handle, handleFrom, onSend } from '../ipc'
import { assertInsideProject } from '../project'
import { encodeMessage, MessageReader } from './framing'
import { serverCommand, serverLocation } from './servers'

interface Session {
  id: string
  key: string
  server: LanguageServerId
  process: ChildProcessWithoutNullStreams
  /** The window whose LSP client talks to this server. */
  owner: WebContents
}

const sessions = new Map<string, Session>()
const byKey = new Map<string, Session>()
/** <appData>/AnyCode, where language servers are installed (scripts/install-language-servers.mjs). */
const appDir = (): string => join(app.getPath('appData'), 'AnyCode')
/** ANYCODE_LSP_TRACE=1 logs every LSP message (method, id and a short payload) in both directions. */
const trace = process.env.ANYCODE_LSP_TRACE === '1'

function traceMessage(server: string, direction: '->' | '<-', message: unknown): void {
  if (!trace) return
  const m = message as { id?: unknown; method?: string; params?: unknown; result?: unknown; error?: unknown }
  const label = m.method ?? `response ${String(m.id)}`
  console.log(`[lsp ${server} ${direction}] ${label} ${JSON.stringify(m.params ?? m.result ?? m.error ?? null).slice(0, 240)}`)
}

function stop(session: Session): void {
  session.process.kill()
  sessions.delete(session.id)
  byKey.delete(session.key)
}

function start(server: LanguageServerId, root: string, owner: WebContents): string {
  const key = `${server}:${root}`
  const existing = byKey.get(key)
  if (existing?.owner === owner) return existing.id
  // The project moved to another window: that window's client initializes a fresh server.
  if (existing) stop(existing)
  const { file, args, env } = serverCommand(server, { root, appDir: appDir(), env: process.env })
  const child = spawn(file, args, { cwd: root, stdio: 'pipe', env: { ...process.env, ...env } })
  const session: Session = { id: randomUUID(), key, server, process: child, owner }
  sessions.set(session.id, session)
  byKey.set(key, session)
  const reader = new MessageReader((message) => {
    traceMessage(server, '<-', message)
    emit(owner, 'lsp:message', session.id, message)
  })
  child.stdout.on('data', (chunk: Buffer) => reader.push(chunk))
  child.stderr.on('data', (chunk: Buffer) => console.log(`[lsp ${server}] ${chunk.toString().trimEnd()}`))
  child.on('error', (error) => console.error(`[lsp ${server}] failed to start:`, error.message))
  child.on('exit', (code) => {
    sessions.delete(session.id)
    if (byKey.get(key) === session) byKey.delete(key)
    emit(owner, 'lsp:exit', session.id, code)
  })
  console.log(`[lsp ${server}] started for ${root} (pid ${child.pid})`)
  return session.id
}

/** Stops every language server, or only those of one window. */
export function stopAllLanguageServers(owner?: WebContents): void {
  for (const session of [...sessions.values()]) {
    if (!owner || session.owner === owner) stop(session)
  }
}

export function registerLspHandlers(): void {
  handle('lsp:locations', () => ({
    typescript: serverLocation('typescript', appDir(), process.env),
    java: serverLocation('java', appDir(), process.env),
    kotlin: serverLocation('kotlin', appDir(), process.env),
  }))
  handleFrom('lsp:start', (owner, server, root) => {
    try {
      return start(server, assertInsideProject(root), owner)
    } catch (error) {
      console.error(`[lsp ${server}] unavailable:`, error instanceof Error ? error.message : error)
      return null
    }
  })
  onSend('lsp:send', (sessionId, message) => {
    const session = sessions.get(sessionId)
    if (!session?.process.stdin.writable) return
    traceMessage(session.server, '->', message)
    session.process.stdin.write(encodeMessage(message))
  })
}
