import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import WebSocket from 'ws'

interface Lock {
  pid: number
  workspaceFolders: string[]
  ideName: string
  transport: string
  authToken: string
}

/** A minimal stand-in for Claude Code: discovers the IDE through its lock file and calls tools. */
export class FakeClaude {
  private nextId = 1
  readonly notifications: { method: string; params: unknown }[] = []

  private constructor(
    private readonly socket: WebSocket,
    readonly port: number,
    readonly lock: Lock,
  ) {
    socket.on('message', (data) => {
      const message = JSON.parse(data.toString()) as { id?: unknown; method?: string; params?: unknown }
      if (message.id === undefined && message.method) this.notifications.push({ method: message.method, params: message.params })
    })
  }

  static async connect(claudeConfigDir: string): Promise<FakeClaude> {
    const dir = join(claudeConfigDir, 'ide')
    const lockName = (await readdir(dir)).find((name) => name.endsWith('.lock'))
    if (!lockName) throw new Error(`no lock file in ${dir}`)
    const lock = JSON.parse(await readFile(join(dir, lockName), 'utf8')) as Lock
    const port = Number(lockName.replace('.lock', ''))
    const socket = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { 'x-claude-code-ide-authorization': lock.authToken } })
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve())
      socket.once('error', reject)
    })
    const client = new FakeClaude(socket, port, lock)
    await client.request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'fake-claude', version: '0' } })
    return client
  }

  request(method: string, params?: unknown): Promise<{ result?: unknown; error?: { code: number; message: string } }> {
    const id = this.nextId++
    return new Promise((resolve) => {
      const onMessage = (data: WebSocket.RawData): void => {
        const message = JSON.parse(data.toString()) as { id?: number; result?: unknown; error?: { code: number; message: string } }
        if (message.id === id) {
          this.socket.off('message', onMessage)
          resolve(message)
        }
      }
      this.socket.on('message', onMessage)
      this.socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
    })
  }

  /** tools/call returning the text parts of the result. */
  async call(name: string, args: Record<string, unknown> = {}): Promise<string[]> {
    const response = await this.request('tools/call', { name, arguments: args })
    if (response.error) throw new Error(`${name}: ${response.error.message}`)
    return (response.result as { content: { text: string }[] }).content.map((c) => c.text)
  }

  close(): void {
    this.socket.close()
  }
}
