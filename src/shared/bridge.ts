// Claude Code IDE bridge: types shared by the main-process server and the renderer that implements
// the editor-side tools. Protocol reference: coder/claudecode.nvim PROTOCOL.md (MIT).

export interface McpTextContent {
  type: 'text'
  text: string
}

/** MCP tools/call result. */
export interface McpToolResult {
  content: McpTextContent[]
  isError?: boolean
}

export interface Position {
  /** 0-based line. */
  line: number
  /** 0-based UTF-16 column. */
  character: number
}

export interface SelectionRange {
  start: Position
  end: Position
  isEmpty: boolean
}

/** Payload of the selection_changed notification and of getCurrentSelection/getLatestSelection. */
export interface EditorSelection {
  text: string
  filePath: string
  fileUrl: string
  selection: SelectionRange
}

/** Payload of the at_mentioned notification; lines are 0-based. */
export interface AtMention {
  filePath: string
  lineStart: number
  lineEnd: number
}

export interface BridgeStatus {
  running: boolean
  port: number | null
  /** Number of Claude Code clients connected right now. */
  clients: number
}

/** Tool names the bridge answers. close_tab is callable but not advertised, like the reference. */
export type BridgeToolName =
  | 'openFile'
  | 'openDiff'
  | 'getCurrentSelection'
  | 'getLatestSelection'
  | 'getOpenEditors'
  | 'getWorkspaceFolders'
  | 'getDiagnostics'
  | 'checkDocumentDirty'
  | 'saveDocument'
  | 'close_tab'
  | 'closeAllDiffTabs'

export const text = (value: string): McpToolResult => ({ content: [{ type: 'text', text: value }] })
export const json = (value: unknown): McpToolResult => text(JSON.stringify(value))
