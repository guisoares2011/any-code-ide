import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { text } from '@shared/bridge'
import { AUTH_HEADER, IdeBridgeServer } from './server'

function connect(port: number, headers: Record<string, string>): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`, { headers })
    socket.once('open', () => resolve(socket))
    socket.once('error', reject)
    socket.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)))
  })
}

function rpc(socket: WebSocket, id: number, method: string, params?: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const onMessage = (data: WebSocket.RawData) => {
      const message = JSON.parse(data.toString()) as Record<string, unknown>
      if (message.id === id) {
        socket.off('message', onMessage)
        resolve(message)
      }
    }
    socket.on('message', onMessage)
    socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
  })
}

describe('IdeBridgeServer', () => {
  let lockDir: string
  let server: IdeBridgeServer
  const calls: [string, unknown][] = []

  beforeEach(async () => {
    lockDir = await mkdtemp(join(tmpdir(), 'anycode-ide-'))
    calls.length = 0
    server = new IdeBridgeServer({
      ideName: 'AnyCode',
      version: '0.1.0',
      workspaceFolders: () => ['/projects/sample'],
      lockDir,
      handleTool: async (name, args) => {
        calls.push([name, args])
        return text(`handled ${name}`)
      },
    })
    await server.start()
  })

  afterEach(async () => {
    await server.stop()
    await rm(lockDir, { recursive: true, force: true })
  })

  it('writes a private lock file with the discovery data', async () => {
    const lock = JSON.parse(await readFile(server.lockFile!, 'utf8')) as Record<string, unknown>
    expect(lock).toMatchObject({ pid: process.pid, workspaceFolders: ['/projects/sample'], ideName: 'AnyCode', transport: 'ws' })
    expect(lock.authToken).toMatch(/^[0-9a-f]{32}$/)
    expect((await stat(server.lockFile!)).mode & 0o777).toBe(0o600)
    expect(server.terminalEnv()).toEqual({ CLAUDE_CODE_SSE_PORT: String(server.port), ENABLE_IDE_INTEGRATION: 'true' })
  })

  it('rejects clients without the token or with an Origin header', async () => {
    await expect(connect(server.port!, {})).rejects.toThrow('401')
    await expect(connect(server.port!, { [AUTH_HEADER]: 'f'.repeat(32) })).rejects.toThrow('401')
    await expect(
      connect(server.port!, { [AUTH_HEADER]: server.tokenForTesting, Origin: 'https://evil.example' }),
    ).rejects.toThrow('401')
  })

  it('speaks MCP: initialize, tools/list and tools/call', async () => {
    const socket = await connect(server.port!, { [AUTH_HEADER]: server.tokenForTesting })
    const init = await rpc(socket, 1, 'initialize', { protocolVersion: '2025-03-26', capabilities: {} })
    expect(init.result).toMatchObject({ serverInfo: { name: 'AnyCode' }, capabilities: { tools: { listChanged: true } } })

    const list = (await rpc(socket, 2, 'tools/list')).result as { tools: { name: string }[] }
    expect(list.tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(['openFile', 'openDiff', 'getDiagnostics', 'getWorkspaceFolders', 'closeAllDiffTabs']),
    )
    expect(list.tools.map((t) => t.name)).not.toContain('close_tab')

    const folders = (await rpc(socket, 3, 'tools/call', { name: 'getWorkspaceFolders', arguments: {} })).result as {
      content: { text: string }[]
    }
    expect(JSON.parse(folders.content[0]!.text)).toMatchObject({ success: true, rootPath: '/projects/sample' })

    const open = await rpc(socket, 4, 'tools/call', { name: 'openFile', arguments: { filePath: '/projects/sample/a.ts' } })
    expect(open.result).toEqual(text('handled openFile'))
    expect(calls).toEqual([['openFile', { filePath: '/projects/sample/a.ts' }]])

    const hidden = await rpc(socket, 5, 'tools/call', { name: 'close_tab', arguments: { tab_name: 'x' } })
    expect(hidden.result).toEqual(text('handled close_tab'))

    const unknown = await rpc(socket, 6, 'tools/call', { name: 'executeCode', arguments: {} })
    expect(unknown.error).toMatchObject({ code: -32601 })
    socket.close()
  })

  it('broadcasts notifications to connected clients and tracks them in the status', async () => {
    const socket = await connect(server.port!, { [AUTH_HEADER]: server.tokenForTesting })
    expect(server.status().clients).toBe(1)
    const received = new Promise<Record<string, unknown>>((resolve) =>
      socket.once('message', (data) => resolve(JSON.parse(data.toString()) as Record<string, unknown>)),
    )
    server.broadcast('selection_changed', { text: 'x' })
    expect(await received).toEqual({ jsonrpc: '2.0', method: 'selection_changed', params: { text: 'x' } })
    socket.close()
  })

  it('removes the lock file on stop', async () => {
    const lock = server.lockFile!
    await server.stop()
    await expect(stat(lock)).rejects.toThrow()
  })
})
