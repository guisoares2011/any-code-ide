// Debug Adapter Protocol connections. Adapters speak DAP over TCP on 127.0.0.1: java-debug inside
// jdtls (port from `vscode.java.startDebugSession`) and js-debug's standalone server, which this
// module starts once per window. Messages are relayed verbatim; the renderer owns the DAP client.
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createServer, connect, type Socket } from 'node:net'
import { join } from 'node:path'
import { app, type WebContents } from 'electron'
import { emit, handle, handleFrom, onSend } from '../ipc'
import { encodeMessage, MessageReader } from '../lsp/framing'
import { javaDebugBundle, jsDebugServer } from './adapters'

interface Connection {
  socket: Socket
  owner: WebContents
}

const connections = new Map<string, Connection>()
/** js-debug servers by window, with the port they listen on. */
const nodeAdapters = new Map<WebContents, { process: ChildProcess; port: Promise<number> }>()
const appDir = (): string => join(app.getPath('appData'), 'AnyCode')
const trace = process.env.ANYCODE_DAP_TRACE === '1'

export const javaDebugJar = (): string | null => javaDebugBundle(appDir(), process.env)

function startNodeAdapter(owner: WebContents): Promise<number> {
  const existing = nodeAdapters.get(owner)
  if (existing && existing.process.exitCode === null) return existing.port
  const server = jsDebugServer(appDir(), process.env)
  if (!server) return Promise.reject(new Error('js-debug is not installed. Run: node scripts/install-language-servers.mjs js-debug'))
  // The app's own runtime as Node: js-debug only needs a Node to run its server.
  const child = spawn(process.execPath, [server, '0', '127.0.0.1'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
  const port = new Promise<number>((resolve, reject) => {
    let output = ''
    child.stdout!.on('data', (chunk: Buffer) => {
      output += chunk.toString()
      const match = /listening at [^\s]*:(\d+)/.exec(output)
      if (match) resolve(Number(match[1]))
    })
    child.stderr!.on('data', (chunk: Buffer) => console.log(`[js-debug] ${chunk.toString().trimEnd()}`))
    child.on('error', reject)
    child.on('exit', (code) => reject(new Error(`js-debug exited with code ${code}`)))
  })
  nodeAdapters.set(owner, { process: child, port })
  child.on('exit', () => {
    if (nodeAdapters.get(owner)?.process === child) nodeAdapters.delete(owner)
  })
  return port
}

function open(owner: WebContents, port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const id = randomUUID()
    const socket = connect({ host: '127.0.0.1', port })
    const reader = new MessageReader((message) => {
      if (trace) console.log(`[dap <-] ${JSON.stringify(message).slice(0, 300)}`)
      emit(owner, 'debug:message', id, message)
    })
    socket.once('connect', () => {
      connections.set(id, { socket, owner })
      resolve(id)
    })
    socket.once('error', (error) => {
      if (!connections.has(id)) reject(error)
    })
    socket.on('data', (chunk: Buffer) => reader.push(chunk))
    socket.on('close', () => {
      if (!connections.delete(id)) return
      emit(owner, 'debug:closed', id)
    })
  })
}

/** A free TCP port on the loopback interface, for the JDWP agent of a debugged JVM. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => (typeof address === 'object' && address ? resolve(address.port) : reject(new Error('no port'))))
    })
  })
}

/**
 * Waits until something listens on a loopback port, without connecting: a JVM waiting for a
 * debugger (Surefire hides its "Listening for transport" line) would take a connection that skips
 * the JDWP handshake as a debugger that came and went.
 */
function waitForListener(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  const listening = (): Promise<boolean> =>
    new Promise((resolve) => execFile('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], (error, stdout) => resolve(!error && stdout.trim() !== '')))
  return new Promise((resolve) => {
    const poll = async (): Promise<void> => {
      if (await listening()) resolve(true)
      else if (Date.now() > deadline) resolve(false)
      else setTimeout(() => void poll(), 400)
    }
    void poll()
  })
}

/** Closes the debug connections and the js-debug server of a window, or of every window. */
export function stopDebugging(owner?: WebContents): void {
  for (const [id, connection] of [...connections]) {
    if (!owner || connection.owner === owner) {
      connections.delete(id)
      connection.socket.destroy()
    }
  }
  for (const [window, adapter] of [...nodeAdapters]) {
    if (!owner || window === owner) {
      adapter.process.kill()
      nodeAdapters.delete(window)
    }
  }
}

export function registerDebugHandlers(): void {
  handle('debug:adapters', () => ({ java: javaDebugJar(), node: jsDebugServer(appDir(), process.env) }))
  handleFrom('debug:startNodeAdapter', (owner) => startNodeAdapter(owner))
  handleFrom('debug:connect', (owner, port) => open(owner, port))
  handle('debug:disconnect', (id) => {
    connections.get(id)?.socket.destroy()
  })
  handle('debug:freePort', () => freePort())
  handle('debug:waitForListener', (port, timeoutMs) => waitForListener(port, timeoutMs))
  onSend('debug:send', (id, message) => {
    const connection = connections.get(id)
    if (!connection || connection.socket.destroyed) return
    if (trace) console.log(`[dap ->] ${JSON.stringify(message).slice(0, 300)}`)
    connection.socket.write(encodeMessage(message))
  })
}
