// Find in Files (⇧⌘F) and Replace in Files (⇧⌘R), IntelliJ's FindInPath/ReplaceInPath popups: the
// search runs on disk in the main process; open documents with unsaved edits are searched here so
// the results match what the editor shows.
import type { editor } from 'monaco-editor'
import { dirname } from '@shared/paths'
import { buildPattern, fileMaskFilter, findMatches, replaceAll, replacementFor, type FileMatches, type SearchMatch, type SearchOptions, type SearchResult } from '@shared/textSearch'
import { currentSelection } from '../bridge/selection'
import { loadedModel, openDocument, saveDocument } from '../editor/documents'
import { createStore } from '../state/store'
import { closePopup, workbench } from '../state/workbench'

export type FindMode = 'find' | 'replace'
export type FindScope = 'project' | 'directory'

export interface FindPopupState {
  mode: FindMode | null
  options: SearchOptions
  /** Whether the file mask applies (IntelliJ's "File mask" checkbox). */
  maskEnabled: boolean
  replacement: string
  scope: FindScope
  directory: string
}

/** The popup and the last query, options and scope, kept between openings like IntelliJ does. */
export const findState = createStore<FindPopupState>({
  mode: null,
  options: { query: '', caseSensitive: false, wholeWords: false, regex: false, fileMask: '' },
  maskEnabled: false,
  replacement: '',
  scope: 'project',
  directory: '',
})

const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Opens the popup; a one-line selection in the editor becomes the query. */
export function openFindInFiles(mode: FindMode): void {
  const project = workbench.get().project
  if (!project) return
  closePopup()
  const selection = currentSelection()
  const selected = selection && selection.filePath === workbench.get().activeTab ? selection.text : ''
  findState.set((s) => {
    const query = selected && !selected.includes('\n') ? (s.options.regex ? escapeRegex(selected) : selected) : s.options.query
    const active = workbench.get().activeTab
    const directory = s.directory.startsWith(`${project.root}/`) || s.directory === project.root ? s.directory : active?.startsWith(`${project.root}/`) ? dirname(active) : project.root
    return { mode, options: { ...s.options, query }, directory }
  })
}

export function closeFindInFiles(): void {
  findState.set({ mode: null })
  window.anycode.send('search:cancel')
}

/** The options as sent to the matcher (the mask only when its checkbox is on). */
export function effectiveOptions(state: FindPopupState): SearchOptions {
  return { ...state.options, fileMask: state.maskEnabled ? state.options.fileMask : '' }
}

let requestId = 0

/** Runs a search; null when a newer one superseded it. */
export async function searchInFiles(root: string, directory: string | undefined, options: SearchOptions): Promise<SearchResult | null> {
  const id = ++requestId
  const result = await window.anycode.invoke('search:find', { id, root, directory, options })
  if (id !== requestId) return null
  return result.error ? result : withUnsavedDocuments(result, root, directory, options)
}

/** Replaces the on-disk results of files with unsaved edits by matches in their editor text. */
function withUnsavedDocuments(result: SearchResult, root: string, directory: string | undefined, options: SearchOptions): SearchResult {
  const pattern = buildPattern(options)
  if (!(pattern instanceof RegExp)) return result
  const scope = directory ?? root
  const inMask = fileMaskFilter(options.fileMask)
  const dirty = [...workbench.get().dirty].filter((path) => path.startsWith(`${scope}/`) && inMask(path.slice(root.length + 1)))
  if (dirty.length === 0) return result
  const files = result.files.filter((f) => !dirty.includes(f.path))
  for (const path of dirty) {
    const model = loadedModel(path)
    if (!model) continue
    const matches = findMatches(model.getValue(), pattern)
    if (matches.length > 0) files.push({ path, matches })
  }
  const order = new Map(result.files.map((f, i) => [f.path, i]))
  files.sort((a, b) => (order.get(a.path) ?? Infinity) - (order.get(b.path) ?? Infinity) || a.path.localeCompare(b.path))
  return { ...result, files, total: files.reduce((n, f) => n + f.matches.length, 0) }
}

function rangeOf(match: SearchMatch) {
  return { startLineNumber: match.line, startColumn: match.column, endLineNumber: match.endLine, endColumn: match.endColumn }
}

/** Applies replacements to a model as one undoable edit, last match first so ranges stay valid. */
function replaceInModel(model: editor.ITextModel, pattern: RegExp, matches: readonly SearchMatch[], replacement: string, regex: boolean): number {
  const edits = matches.flatMap((match) => {
    const range = rangeOf(match)
    const text = model.getValueInRange(range)
    // The text changed since the search: leave this one alone.
    if (findMatches(text, pattern).length === 0) return []
    return [{ range, text: replacementFor(text, pattern, replacement, regex) }]
  })
  if (edits.length > 0) model.pushEditOperations([], edits, () => null)
  return edits.length
}

/** Replace: the one occurrence, in the document (opened if needed), saved like IntelliJ does. */
export async function replaceOne(path: string, match: SearchMatch, options: SearchOptions, replacement: string): Promise<boolean> {
  const pattern = buildPattern(options)
  if (!(pattern instanceof RegExp)) return false
  const document = await openDocument(path)
  if (document.kind !== 'text') return false
  const replaced = replaceInModel(document.model, pattern, [match], replacement, options.regex) > 0
  if (replaced) await saveDocument(path)
  return replaced
}

/**
 * Replace All: open documents are edited (undoable) and saved; other files are rewritten on disk,
 * where every current match is replaced. Returns how many files changed.
 */
export async function replaceAllInFiles(files: readonly FileMatches[], options: SearchOptions, replacement: string): Promise<number> {
  const pattern = buildPattern(options)
  if (!(pattern instanceof RegExp)) return 0
  let changed = 0
  for (const file of files) {
    const model = loadedModel(file.path)
    if (model) {
      if (replaceInModel(model, pattern, findMatches(model.getValue(), pattern), replacement, options.regex) > 0) {
        await saveDocument(file.path)
        changed++
      }
      continue
    }
    const content = await window.anycode.invoke('fs:readFile', file.path)
    if (content.kind !== 'text') continue
    const next = replaceAll(content.content, pattern, replacement, options.regex)
    if (next === content.content) continue
    await window.anycode.invoke('fs:writeFile', file.path, next)
    changed++
  }
  return changed
}
