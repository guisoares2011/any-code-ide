// Electron glue for the Claude Code bridge: tool calls go to the renderer (which owns editors,
// selections and diffs) and come back through bridge:toolResult.
import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import { text, type McpToolResult } from '@shared/bridge'
import { emit, handle, onSend } from '../ipc'
import { IdeBridgeServer } from './server'

/** Non-blocking tools must answer within this time; openDiff waits for the user. */
const TOOL_TIMEOUT_MS = 30_000
const BLOCKING_TOOLS = new Set(['openDiff'])

const pending = new Map<string, (result: McpToolResult) => void>()

export function createBridge(options: {
  version: string
  workspaceFolders: () => string[]
  renderer: () => WebContents | null
}): IdeBridgeServer {
  const server = new IdeBridgeServer({
    ideName: 'AnyCode',
    version: options.version,
    workspaceFolders: options.workspaceFolders,
    handleTool: (name, args) =>
      new Promise<McpToolResult>((resolve) => {
        const target = options.renderer()
        if (!target) return resolve({ ...text('AnyCode has no open window'), isError: true })
        const requestId = randomUUID()
        const timer = BLOCKING_TOOLS.has(name)
          ? null
          : setTimeout(() => {
              pending.delete(requestId)
              resolve({ ...text(`Timed out waiting for the editor to answer ${name}`), isError: true })
            }, TOOL_TIMEOUT_MS)
        pending.set(requestId, (result) => {
          if (timer) clearTimeout(timer)
          resolve(result)
        })
        emit(target, 'bridge:toolCall', requestId, name, args)
      }),
    onStatusChange: (status) => {
      const target = options.renderer()
      if (target) emit(target, 'bridge:status', status)
    },
    log: (message) => console.log(`[bridge] ${message}`),
  })

  handle('bridge:toolResult', (requestId, result) => {
    pending.get(requestId)?.(result)
    pending.delete(requestId)
  })
  handle('bridge:status', () => server.status())
  onSend('bridge:selectionChanged', (selection) => server.broadcast('selection_changed', selection))
  onSend('bridge:atMentioned', (mention) => server.broadcast('at_mentioned', mention))
  return server
}

/** Rejects every outstanding call, e.g. when the window reloads. */
export function failPendingToolCalls(reason: string): void {
  for (const [id, resolve] of pending) {
    resolve({ ...text(reason), isError: true })
    pending.delete(id)
  }
}
