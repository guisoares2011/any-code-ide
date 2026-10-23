// Renderer end of the Claude Code bridge: answers tool calls and mirrors the connection status.
import type { BridgeStatus } from '@shared/bridge'
import { reloadChanged } from '../editor/documents'
import { createStore } from '../state/store'
import { handleEditorTool } from './editorTools'

export const bridgeStatus = createStore<BridgeStatus>({ running: false, port: null, clients: 0 })

let installed = false

export function installBridgeClient(): void {
  if (installed) return
  installed = true
  window.anycode.on('bridge:toolCall', (requestId, name, args) => {
    void handleEditorTool(name, args)
      .catch((error: unknown) => ({
        content: [{ type: 'text' as const, text: `AnyCode failed to run ${name}: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      }))
      .then((result) => window.anycode.invoke('bridge:toolResult', requestId, result))
  })
  window.anycode.on('bridge:status', (status) => bridgeStatus.set(status))
  void window.anycode.invoke('bridge:status').then((status) => bridgeStatus.set(status))
  window.anycode.on('fs:changed', (paths) => void reloadChanged(paths))
}
