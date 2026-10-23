// Electron glue for the Claude Code bridge: one server (and lock file) per window, so the `claude` of
// a window sees that window's projects and its tool calls reach that window's renderer, which owns
// editors, selections and diffs. Results come back through bridge:toolResult.
import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import { text, type McpToolResult } from '@shared/bridge'
import { emit, handle, handleFrom, onSendFrom } from '../ipc'
import { IdeBridgeServer } from './server'

/** Non-blocking tools must answer within this time; openDiff waits for the user. */
const TOOL_TIMEOUT_MS = 30_000
const BLOCKING_TOOLS = new Set(['openDiff'])

/** Outstanding tool calls by request id, with the window that has to answer. */
const pending = new Map<string, { owner: WebContents; resolve: (result: McpToolResult) => void }>()

export function createBridge(options: { version: string; workspaceFolders: () => string[]; renderer: WebContents }): IdeBridgeServer {
  const target = options.renderer
  return new IdeBridgeServer({
    ideName: 'AnyCode',
    version: options.version,
    workspaceFolders: options.workspaceFolders,
    handleTool: (name, args) =>
      new Promise<McpToolResult>((resolve) => {
        if (target.isDestroyed()) return resolve({ ...text('The AnyCode window was closed'), isError: true })
        const requestId = randomUUID()
        const timer = BLOCKING_TOOLS.has(name)
          ? null
          : setTimeout(() => {
              pending.delete(requestId)
              resolve({ ...text(`Timed out waiting for the editor to answer ${name}`), isError: true })
            }, TOOL_TIMEOUT_MS)
        pending.set(requestId, {
          owner: target,
          resolve: (result) => {
            if (timer) clearTimeout(timer)
            resolve(result)
          },
        })
        emit(target, 'bridge:toolCall', requestId, name, args)
      }),
    onStatusChange: (status) => emit(target, 'bridge:status', status),
    log: (message) => console.log(`[bridge] ${message}`),
  })
}

/** IPC of every window's bridge; `bridgeOf` finds the bridge of the window that sent a message. */
export function registerBridgeHandlers(bridgeOf: (sender: WebContents) => IdeBridgeServer | undefined): void {
  handle('bridge:toolResult', (requestId, result) => {
    pending.get(requestId)?.resolve(result)
    pending.delete(requestId)
  })
  handleFrom('bridge:status', (sender) => bridgeOf(sender)?.status() ?? { running: false, port: null, clients: 0 })
  onSendFrom('bridge:selectionChanged', (sender, selection) => bridgeOf(sender)?.broadcast('selection_changed', selection))
  onSendFrom('bridge:atMentioned', (sender, mention) => bridgeOf(sender)?.broadcast('at_mentioned', mention))
}

/** Rejects the outstanding calls a window has to answer, e.g. when it reloads or closes. */
export function failPendingToolCalls(owner: WebContents, reason: string): void {
  for (const [id, call] of pending) {
    if (call.owner !== owner) continue
    call.resolve({ ...text(reason), isError: true })
    pending.delete(id)
  }
}
