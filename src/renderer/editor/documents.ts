// Text documents backed by Monaco models: loading from disk, dirty tracking, saving and reloading
// files changed on disk (by the agent) when they have no unsaved edits.
import type { editor, IRange } from 'monaco-editor'
import { basename } from '@shared/paths'
import { createStore } from '../state/store'
import { closeTab, setDirty, workbench } from '../state/workbench'
import { languageForFile, setupMonaco } from './monacoSetup'

export type DocumentState =
  | { kind: 'text'; model: editor.ITextModel }
  | { kind: 'binary' | 'too-large'; size: number }
  | { kind: 'error'; message: string }

interface Entry {
  state: DocumentState
  savedVersion: number
}

const documents = new Map<string, Promise<Entry>>()
const loaded = new Map<string, Entry>()
/** Selections to reveal once a document is shown (openFile from Claude Code). */
const pendingReveal = new Map<string, IRange>()
/** Bumps on every reveal request so an editor already showing the file applies it. */
export const revealRequests = createStore({ seq: 0 })

export function openDocument(path: string): Promise<DocumentState> {
  let entry = documents.get(path)
  if (!entry) {
    entry = load(path)
    documents.set(path, entry)
  }
  return entry.then((e) => e.state)
}

/** The model of a document that finished loading, if any. */
export function loadedModel(path: string): editor.ITextModel | undefined {
  const state = loaded.get(path)?.state
  return state?.kind === 'text' ? state.model : undefined
}

async function load(path: string): Promise<Entry> {
  const monaco = setupMonaco()
  try {
    const content = await window.anycode.invoke('fs:readFile', path)
    if (content.kind !== 'text') return { state: { kind: content.kind, size: content.size }, savedVersion: 0 }
    const uri = monaco.Uri.file(path)
    const model =
      monaco.editor.getModel(uri) ?? monaco.editor.createModel(content.content, languageForFile(basename(path)), uri)
    const entry: Entry = { state: { kind: 'text', model }, savedVersion: model.getAlternativeVersionId() }
    model.onDidChangeContent(() => setDirty(path, model.getAlternativeVersionId() !== entry.savedVersion))
    loaded.set(path, entry)
    return entry
  } catch (error) {
    return { state: { kind: 'error', message: error instanceof Error ? error.message : String(error) }, savedVersion: 0 }
  }
}

export async function saveDocument(path: string): Promise<boolean> {
  const entry = await documents.get(path)
  if (entry?.state.kind !== 'text') return false
  const { model } = entry.state
  const version = model.getAlternativeVersionId()
  await window.anycode.invoke('fs:writeFile', path, model.getValue())
  entry.savedVersion = version
  setDirty(path, model.getAlternativeVersionId() !== version)
  return true
}

/** Writes every modified document (SaveAll). */
export async function saveAll(): Promise<void> {
  await Promise.all([...workbench.get().dirty].map((path) => saveDocument(path)))
}

/** Releases a document whose tab closed; modified documents stay loaded. */
export async function releaseDocument(path: string): Promise<void> {
  const entry = await documents.get(path)
  if (!entry || workbench.get().dirty.has(path)) return
  if (entry.state.kind === 'text') entry.state.model.dispose()
  documents.delete(path)
  loaded.delete(path)
}

/**
 * Reloads clean documents whose files changed on disk. The text is replaced with an undoable edit
 * so the user can step back over what the agent wrote.
 */
export async function reloadChanged(paths: readonly string[]): Promise<void> {
  for (const path of paths) {
    const entry = loaded.get(path)
    if (entry?.state.kind !== 'text' || workbench.get().dirty.has(path)) continue
    const { model } = entry.state
    let content
    try {
      content = await window.anycode.invoke('fs:readFile', path)
    } catch {
      continue // deleted or moved; keep the buffer
    }
    if (content.kind !== 'text' || content.content === model.getValue()) continue
    model.pushEditOperations([], [{ range: model.getFullModelRange(), text: content.content }], () => null)
    entry.savedVersion = model.getAlternativeVersionId()
    setDirty(path, false)
  }
}

/**
 * Puts documents back to what is on disk after a rollback, discarding unsaved edits like
 * IntelliJ does; tabs of files that no longer exist close.
 */
export async function revertDocuments(paths: readonly string[]): Promise<void> {
  for (const path of paths) {
    const entry = loaded.get(path)
    if (entry?.state.kind !== 'text') continue
    const { model } = entry.state
    let content
    try {
      content = await window.anycode.invoke('fs:readFile', path)
    } catch {
      setDirty(path, false)
      closeTab(path)
      await releaseDocument(path)
      continue
    }
    if (content.kind !== 'text') continue
    if (content.content !== model.getValue()) {
      model.pushEditOperations([], [{ range: model.getFullModelRange(), text: content.content }], () => null)
    }
    entry.savedVersion = model.getAlternativeVersionId()
    setDirty(path, false)
  }
}

export function requestReveal(path: string, range: IRange): void {
  pendingReveal.set(path, range)
  revealRequests.set((s) => ({ seq: s.seq + 1 }))
}

/** Applies and clears a pending reveal for `path` on the editor showing it. */
export function applyPendingReveal(path: string, instance: editor.ICodeEditor): void {
  const range = pendingReveal.get(path)
  if (!range) return
  pendingReveal.delete(path)
  instance.setSelection(range)
  instance.revealRangeInCenterIfOutsideViewport(range)
}

/**
 * A file or directory was renamed or moved: open documents below `from` follow it to `to`, keeping
 * unsaved edits. Monaco models cannot change URI, so each gets a new model with the same text.
 */
export async function relocateDocuments(from: string, to: string): Promise<void> {
  const monaco = setupMonaco()
  for (const [path, promise] of [...documents]) {
    if (path !== from && !path.startsWith(`${from}/`)) continue
    const target = to + path.slice(from.length)
    const entry = await promise
    documents.delete(path)
    loaded.delete(path)
    if (entry.state.kind !== 'text') continue
    const old = entry.state.model
    const wasDirty = old.getAlternativeVersionId() !== entry.savedVersion
    const model = monaco.editor.createModel(old.getValue(), languageForFile(basename(target)), monaco.Uri.file(target))
    old.dispose()
    // A dirty document stays dirty until it is saved again.
    const moved: Entry = { state: { kind: 'text', model }, savedVersion: wasDirty ? -1 : model.getAlternativeVersionId() }
    model.onDidChangeContent(() => setDirty(target, model.getAlternativeVersionId() !== moved.savedVersion))
    documents.set(target, Promise.resolve(moved))
    loaded.set(target, moved)
  }
}

/** Files deleted from the IDE: their tabs close and unsaved edits are dropped. */
export async function discardDocuments(paths: readonly string[]): Promise<void> {
  const under = (path: string): boolean => paths.some((p) => path === p || path.startsWith(`${p}/`))
  for (const tab of workbench.get().tabs.filter((t) => t.kind === 'file' && under(t.path))) closeTab(tab.path)
  for (const path of [...documents.keys()].filter(under)) {
    const entry = await documents.get(path)
    if (entry?.state.kind === 'text') entry.state.model.dispose()
    documents.delete(path)
    loaded.delete(path)
  }
}
