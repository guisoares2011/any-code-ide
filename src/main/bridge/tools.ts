// MCP tool declarations of the Claude Code IDE bridge (names, descriptions and input schemas as in
// coder/claudecode.nvim, MIT). close_tab is answered but not listed in tools/list.
import type { BridgeToolName } from '@shared/bridge'

export interface ToolDeclaration {
  name: BridgeToolName
  description: string
  inputSchema: Record<string, unknown>
}

const SCHEMA = 'http://json-schema.org/draft-07/schema#'

const noInput = { type: 'object', additionalProperties: false, $schema: SCHEMA }

const filePathInput = (description: string) => ({
  type: 'object',
  properties: { filePath: { type: 'string', description } },
  required: ['filePath'],
  additionalProperties: false,
  $schema: SCHEMA,
})

export const ADVERTISED_TOOLS: readonly ToolDeclaration[] = [
  {
    name: 'openFile',
    description: 'Open a file in the editor and optionally select a range of text',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Path to the file to open' },
        preview: { type: 'boolean', description: 'Whether to open the file in preview mode', default: false },
        startLine: { type: 'integer', description: 'Optional: Line number to start selection' },
        endLine: { type: 'integer', description: 'Optional: Line number to end selection' },
        startText: {
          type: 'string',
          description: 'Text pattern to find the start of the selection range. Selects from the beginning of this match.',
        },
        endText: {
          type: 'string',
          description:
            'Text pattern to find the end of the selection range. Selects up to the end of this match. If not provided, only the startText match will be selected.',
        },
        selectToEndOfLine: {
          type: 'boolean',
          description: 'If true, selection will extend to the end of the line containing the endText match.',
          default: false,
        },
        makeFrontmost: {
          type: 'boolean',
          description: 'Whether to make the file the active editor tab. If false, the file will be opened in the background without changing focus.',
          default: true,
        },
      },
      required: ['filePath'],
      additionalProperties: false,
      $schema: SCHEMA,
    },
  },
  {
    name: 'openDiff',
    description: 'Open a diff view comparing old file content with new file content',
    inputSchema: {
      type: 'object',
      properties: {
        old_file_path: { type: 'string', description: 'Path to the old file to compare' },
        new_file_path: { type: 'string', description: 'Path to the new file to compare' },
        new_file_contents: { type: 'string', description: 'Contents for the new file version' },
        tab_name: { type: 'string', description: 'Name for the diff tab/view' },
      },
      required: ['old_file_path', 'new_file_path', 'new_file_contents', 'tab_name'],
      additionalProperties: false,
      $schema: SCHEMA,
    },
  },
  { name: 'getCurrentSelection', description: 'Get the current text selection in the editor', inputSchema: noInput },
  {
    name: 'getLatestSelection',
    description: 'Get the most recent text selection (even if not in the active editor)',
    inputSchema: noInput,
  },
  { name: 'getOpenEditors', description: 'Get list of currently open files', inputSchema: noInput },
  { name: 'getWorkspaceFolders', description: 'Get all workspace folders currently open in the IDE', inputSchema: noInput },
  {
    name: 'getDiagnostics',
    description: 'Get language diagnostics (errors, warnings) from the editor',
    inputSchema: {
      type: 'object',
      properties: {
        uri: {
          type: 'string',
          description: 'Optional file URI to get diagnostics for. If not provided, gets diagnostics for all open files.',
        },
      },
      additionalProperties: false,
      $schema: SCHEMA,
    },
  },
  {
    name: 'checkDocumentDirty',
    description: 'Check if a document has unsaved changes (is dirty)',
    inputSchema: filePathInput('Path to the file to check'),
  },
  { name: 'saveDocument', description: 'Save a document with unsaved changes', inputSchema: filePathInput('Path to the file to save') },
  { name: 'closeAllDiffTabs', description: 'Close all diff tabs in the editor', inputSchema: noInput },
]

export const CALLABLE_TOOLS: ReadonlySet<string> = new Set<string>([...ADVERTISED_TOOLS.map((t) => t.name), 'close_tab'])
