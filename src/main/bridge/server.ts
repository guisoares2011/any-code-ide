// WebSocket MCP server Claude Code connects to (the /ide integration). Binds to 127.0.0.1 only,
// authenticates with the x-claude-code-ide-authorization header and speaks JSON-RPC 2.0 / MCP.
// Pure Node: no Electron imports, so it can be tested and exercised against the real CLI.
import { rmSync } from 'node:fs'
import type { IncomingMessage } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import { text, type BridgeStatus, type McpToolResult } from '@shared/bridge'
import { generateAuthToken, lockDirectory, removeLockFile, writeLockFile } from './lockfile'
import { ADVERTISED_TOOLS, CALLABLE_TOOLS } from './tools'

/** MCP revision answered in initialize, the one the reference implementation uses. */
export const MCP_PROTOCOL_VERSION = '2024-11-05'
export const AUTH_HEADER = 'x-claude-code-ide-authorization'

export type ToolHandler = (name: string, args: Record<string, unknown>) => Promise<McpToolResult>

export interface BridgeOptions {
  ideName: string
  version: string
  workspaceFolders: () => string[]
  handleTool: ToolHandler
  lockDir?: string
  onStatusChange?: (status: BridgeStatus) => void
  /** Diagnostics without secrets (never the token). */
  log?: (message: string) => void
  /** Every JSON-RPC message in and out, for protocol probes. Messages never carry the token. */
  trace?: (direction: 'in' | 'out', message: unknown) => void
}

interface JsonRpcMessage {
  jsonrpc: '2.0'
  id?: string | number | null
  method?: string
  params?: unknown
}

const JSON_RPC = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
}

export class IdeBridgeServer {
  private server: WebSocketServer | null = null
  private readonly clients = new Set<WebSocket>()
  private lockPath: string | null = null
  private portValue: number | null = null
  private readonly authToken = generateAuthToken()

  constructor(private readonly options: BridgeOptions) {}

  get port(): number | null {
    return this.portValue
  }

  status(): BridgeStatus {
    return { running: this.server !== null, port: this.portValue, clients: this.clients.size }
  }

  /** Environment for terminals that should connect to this IDE (claude reads it at startup). */
  terminalEnv(): Record<string, string> {
    return this.portValue === null ? {} : { CLAUDE_CODE_SSE_PORT: String(this.portValue), ENABLE_IDE_INTEGRATION: 'true' }
  }

  async start(): Promise<number> {
    const server = new WebSocketServer({
      host: '127.0.0.1',
      port: 0,
      maxPayload: 64 * 1024 * 1024,
      verifyClient: ({ req }: { req: IncomingMessage }) => this.authorize(req),
    })
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve)
      server.once('error', reject)
    })
    const address = server.address()
    if (typeof address !== 'object' || address === null) throw new Error('Bridge server has no TCP address')
    this.server = server
    this.portValue = address.port
    server.on('connection', (socket) => this.accept(socket))
    this.lockPath = await writeLockFile(this.options.lockDir ?? lockDirectory(), address.port, {
      pid: process.pid,
      workspaceFolders: this.options.workspaceFolders(),
      ideName: this.options.ideName,
      transport: 'ws',
      authToken: this.authToken,
    })
    this.log(`listening on 127.0.0.1:${address.port}`)
    this.changed()
    return address.port
  }

  async stop(): Promise<void> {
    for (const client of this.clients) client.terminate()
    this.clients.clear()
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()))
    this.server = null
    if (this.lockPath) await removeLockFile(this.lockPath)
    this.lockPath = null
    this.portValue = null
    this.changed()
  }

  /** Rewrites the lock file after projects open or close, so new `claude` sessions find them. */
  async updateWorkspaceFolders(): Promise<void> {
    if (this.portValue === null || !this.lockPath) return
    this.lockPath = await writeLockFile(this.options.lockDir ?? lockDirectory(), this.portValue, {
      pid: process.pid,
      workspaceFolders: this.options.workspaceFolders(),
      ideName: this.options.ideName,
      transport: 'ws',
      authToken: this.authToken,
    })
  }

  /** Synchronous shutdown for process exit: drops clients, closes the socket, deletes the lock. */
  disposeSync(): void {
    for (const client of this.clients) client.terminate()
    this.clients.clear()
    this.server?.close()
    this.server = null
    if (this.lockPath) rmSync(this.lockPath, { force: true })
    this.lockPath = null
  }

  /** Sends a notification (selection_changed, at_mentioned...) to every connected client. */
  broadcast(method: string, params: unknown): void {
    const message = JSON.stringify({ jsonrpc: '2.0', method, params })
    for (const client of this.clients) if (client.readyState === client.OPEN) client.send(message)
  }

  /** Lock path for tests and diagnostics. */
  get lockFile(): string | null {
    return this.lockPath
  }

  /** Token for tests that act as the client; production code never reads it back. */
  get tokenForTesting(): string {
    return this.authToken
  }

  private authorize(req: IncomingMessage): boolean {
    // Browsers always send Origin; Claude Code does not. Refusing it blocks cross-site WebSocket hijacking.
    if (req.headers.origin) {
      this.log('rejected connection with an Origin header')
      return false
    }
    const ok = req.headers[AUTH_HEADER] === this.authToken
    if (!ok) this.log('rejected connection with a missing or invalid auth token')
    return ok
  }

  private accept(socket: WebSocket): void {
    this.clients.add(socket)
    this.log(`client connected (${this.clients.size})`)
    this.changed()
    socket.on('message', (data) => void this.receive(socket, data.toString()))
    socket.on('close', () => {
      this.clients.delete(socket)
      this.log(`client disconnected (${this.clients.size})`)
      this.changed()
    })
    socket.on('error', () => socket.terminate())
  }

  private async receive(socket: WebSocket, raw: string): Promise<void> {
    let message: JsonRpcMessage
    try {
      message = JSON.parse(raw) as JsonRpcMessage
      this.options.trace?.('in', message)
    } catch {
      return this.reply(socket, null, undefined, { code: JSON_RPC.PARSE_ERROR, message: 'Parse error' })
    }
    const isRequest = message.id !== undefined && message.id !== null
    if (typeof message.method !== 'string') {
      if (isRequest) this.reply(socket, message.id ?? null, undefined, { code: JSON_RPC.INVALID_REQUEST, message: 'Invalid Request' })
      return
    }
    this.log(`<- ${message.method}${isRequest ? '' : ' (notification)'}`)
    if (!isRequest) return
    try {
      const result = await this.handle(message.method, message.params)
      this.reply(socket, message.id ?? null, result)
    } catch (error) {
      const rpc = error as { code?: number; message?: string }
      this.reply(socket, message.id ?? null, undefined, {
        code: rpc.code ?? JSON_RPC.INTERNAL_ERROR,
        message: rpc.message ?? String(error),
      })
    }
  }

  private async handle(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case 'initialize':
        return {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { logging: {}, prompts: { listChanged: true }, tools: { listChanged: true } },
          serverInfo: { name: this.options.ideName, version: this.options.version },
        }
      case 'ping':
        return {}
      case 'tools/list':
        return { tools: ADVERTISED_TOOLS }
      case 'prompts/list':
        return { prompts: [] }
      case 'resources/list':
        return { resources: [] }
      case 'tools/call': {
        const { name, arguments: args } = (params ?? {}) as { name?: string; arguments?: Record<string, unknown> }
        if (!name || !CALLABLE_TOOLS.has(name)) {
          throw { code: JSON_RPC.METHOD_NOT_FOUND, message: `Tool not found: ${name ?? '(none)'}` }
        }
        if (name === 'getWorkspaceFolders') return this.workspaceFolders()
        return this.options.handleTool(name, args ?? {})
      }
      default:
        throw { code: JSON_RPC.METHOD_NOT_FOUND, message: `Method not found: ${method}` }
    }
  }

  private workspaceFolders(): McpToolResult {
    const folders = this.options.workspaceFolders()
    return text(
      JSON.stringify({
        success: true,
        folders: folders.map((path) => ({ name: path.split('/').pop() ?? path, uri: `file://${path}`, path })),
        rootPath: folders[0] ?? null,
      }),
    )
  }

  private reply(socket: WebSocket, id: JsonRpcMessage['id'], result?: unknown, error?: { code: number; message: string }): void {
    if (socket.readyState !== socket.OPEN) return
    const message = error ? { jsonrpc: '2.0', id, error } : { jsonrpc: '2.0', id, result }
    this.options.trace?.('out', message)
    socket.send(JSON.stringify(message))
  }

  private changed(): void {
    this.options.onStatusChange?.(this.status())
  }

  private log(message: string): void {
    this.options.log?.(message)
  }
}
