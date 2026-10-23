// Editor-side implementations of the Claude Code IDE tools (names and result shapes from
// coder/claudecode.nvim PROTOCOL.md). getWorkspaceFolders is answered by the main process.
import * as monaco from 'monaco-editor'
import { json, text, type McpToolResult } from '@shared/bridge'
import { basename } from '@shared/paths'
import { loadedModel, openDocument, requestReveal, saveDocument } from '../editor/documents'
import { languageForFile } from '../editor/monacoSetup'
import { closeTab, diffTabKey, openFile, openFileInBackground, workbench } from '../state/workbench'
import { openDiff, rejectAllDiffs, rejectDiff, pendingDiff } from './diffs'
import { currentSelection, latestSelection } from './selection'

type Args = Record<string, unknown>

const str = (args: Args, key: string): string | undefined => (typeof args[key] === 'string' ? (args[key] as string) : undefined)
const num = (args: Args, key: string): number | undefined => (typeof args[key] === 'number' ? (args[key] as number) : undefined)
const bool = (args: Args, key: string, fallback: boolean): boolean =>
  typeof args[key] === 'boolean' ? (args[key] as boolean) : fallback

function absolute(path: string): string {
  if (path.startsWith('/')) return path
  const root = workbench.get().project?.root ?? ''
  return `${root}/${path.replace(/^\.\//, '')}`
}

function invalid(message: string): McpToolResult {
  return { ...text(message), isError: true }
}

/** Range for openFile's startLine/endLine (1-based) or startText/endText arguments. */
export function selectionRange(model: monaco.editor.ITextModel, args: Args): monaco.IRange | null {
  const startLine = num(args, 'startLine')
  const endLine = num(args, 'endLine')
  if (startLine !== undefined) {
    const last = Math.min(Math.max(endLine ?? startLine, startLine), model.getLineCount())
    const first = Math.min(Math.max(startLine, 1), model.getLineCount())
    return { startLineNumber: first, startColumn: 1, endLineNumber: last, endColumn: model.getLineMaxColumn(last) }
  }
  const startText = str(args, 'startText')
  if (!startText) return null
  const start = model.findNextMatch(startText, { lineNumber: 1, column: 1 }, false, true, null, false)
  if (!start) return null
  let end = start.range
  const endText = str(args, 'endText')
  if (endText) {
    const match = model.findNextMatch(endText, start.range.getEndPosition(), false, true, null, false)
    if (match && monaco.Range.compareRangesUsingStarts(match.range, start.range) >= 0) end = match.range
  }
  const endColumn = bool(args, 'selectToEndOfLine', false) ? model.getLineMaxColumn(end.endLineNumber) : end.endColumn
  return {
    startLineNumber: start.range.startLineNumber,
    startColumn: start.range.startColumn,
    endLineNumber: end.endLineNumber,
    endColumn,
  }
}

async function openFileTool(args: Args): Promise<McpToolResult> {
  const raw = str(args, 'filePath')
  if (!raw) return invalid('Missing required parameter: filePath')
  const path = absolute(raw)
  const document = await openDocument(path)
  if (document.kind === 'error') return invalid(`Failed to open file: ${document.message}`)
  if (document.kind === 'text') {
    const range = selectionRange(document.model, args)
    if (range) requestReveal(path, range)
  }
  const frontmost = bool(args, 'makeFrontmost', true)
  if (frontmost) {
    openFile(path)
    return text(`Opened file: ${path}`)
  }
  openFileInBackground(path)
  return json({
    success: true,
    filePath: path,
    languageId: document.kind === 'text' ? document.model.getLanguageId() : languageForFile(basename(path)),
    lineCount: document.kind === 'text' ? document.model.getLineCount() : 0,
  })
}

function selectionResult(selection: ReturnType<typeof currentSelection>, missing: string): McpToolResult {
  if (!selection) return json({ success: false, message: missing })
  return json({ success: true, text: selection.text, filePath: selection.filePath, fileUrl: selection.fileUrl, selection: selection.selection })
}

function openEditors(): McpToolResult {
  const { tabs, activeTab, dirty } = workbench.get()
  return json({
    tabs: tabs
      .filter((tab) => tab.kind === 'file')
      .map((tab) => ({
        uri: monaco.Uri.file(tab.path).toString(),
        isActive: tab.path === activeTab,
        label: tab.name,
        languageId: loadedModel(tab.path)?.getLanguageId() ?? languageForFile(tab.name),
        isDirty: dirty.has(tab.path),
      })),
  })
}

const SEVERITY: Record<number, string> = {
  [monaco.MarkerSeverity.Error]: 'Error',
  [monaco.MarkerSeverity.Warning]: 'Warning',
  [monaco.MarkerSeverity.Info]: 'Information',
  [monaco.MarkerSeverity.Hint]: 'Hint',
}

function diagnostics(args: Args): McpToolResult {
  const uri = str(args, 'uri')
  const markers = monaco.editor.getModelMarkers(uri ? { resource: monaco.Uri.parse(uri) } : {})
  const byFile = new Map<string, unknown[]>()
  for (const marker of markers) {
    const key = marker.resource.toString()
    byFile.set(key, [
      ...(byFile.get(key) ?? []),
      {
        message: marker.message,
        severity: SEVERITY[marker.severity] ?? 'Information',
        range: {
          start: { line: marker.startLineNumber - 1, character: marker.startColumn - 1 },
          end: { line: marker.endLineNumber - 1, character: marker.endColumn - 1 },
        },
        source: marker.source ?? marker.owner,
      },
    ])
  }
  return json([...byFile].map(([file, list]) => ({ uri: file, diagnostics: list })))
}

function isOpen(path: string): boolean {
  return workbench.get().tabs.some((tab) => tab.kind === 'file' && tab.path === path)
}

async function documentTool(name: 'checkDocumentDirty' | 'saveDocument', args: Args): Promise<McpToolResult> {
  const raw = str(args, 'filePath')
  if (!raw) return invalid('Missing required parameter: filePath')
  const path = absolute(raw)
  if (!isOpen(path)) return json({ success: false, message: `Document not open: ${path}` })
  if (name === 'checkDocumentDirty') {
    return json({ success: true, filePath: path, isDirty: workbench.get().dirty.has(path), isUntitled: false })
  }
  const saved = await saveDocument(path)
  return json({ success: saved, filePath: path, saved, message: saved ? 'Document saved successfully' : 'Document could not be saved' })
}

function closeTabTool(args: Args): McpToolResult {
  const name = str(args, 'tab_name')
  if (!name) return invalid('Missing required parameter: tab_name')
  if (pendingDiff(name)) rejectDiff(name)
  else {
    const tab = workbench.get().tabs.find((t) => t.path === diffTabKey(name) || (t.kind === 'file' && t.name === name))
    if (tab) closeTab(tab.path)
  }
  return text('TAB_CLOSED')
}

export async function handleEditorTool(name: string, args: Args): Promise<McpToolResult> {
  switch (name) {
    case 'openFile':
      return openFileTool(args)
    case 'openDiff': {
      const required = ['old_file_path', 'new_file_path', 'new_file_contents', 'tab_name'] as const
      const missing = required.find((key) => typeof args[key] !== 'string')
      if (missing) return invalid(`Missing required parameter: ${missing}`)
      return openDiff({
        old_file_path: absolute(args.old_file_path as string),
        new_file_path: absolute(args.new_file_path as string),
        new_file_contents: args.new_file_contents as string,
        tab_name: args.tab_name as string,
      })
    }
    case 'getCurrentSelection':
      return selectionResult(currentSelection(), 'No active editor found')
    case 'getLatestSelection':
      return selectionResult(latestSelection(), 'No selection available')
    case 'getOpenEditors':
      return openEditors()
    case 'getDiagnostics':
      return diagnostics(args)
    case 'checkDocumentDirty':
    case 'saveDocument':
      return documentTool(name, args)
    case 'close_tab':
      return closeTabTool(args)
    case 'closeAllDiffTabs':
      return text(`CLOSED_${rejectAllDiffs()}_DIFF_TABS`)
    default:
      return invalid(`Unknown tool: ${name}`)
  }
}
