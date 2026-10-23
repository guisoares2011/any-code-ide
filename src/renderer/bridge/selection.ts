// Editor selection as Claude Code sees it: getCurrentSelection/getLatestSelection and the
// debounced selection_changed notification. Positions are 0-based, like LSP.
import type { editor } from 'monaco-editor'
import type { EditorSelection } from '@shared/bridge'

const DEBOUNCE_MS = 100

let current: EditorSelection | null = null
let latest: EditorSelection | null = null
let lastSent = ''
let timer: ReturnType<typeof setTimeout> | null = null

export function selectionFromEditor(instance: editor.ICodeEditor): EditorSelection | null {
  const model = instance.getModel()
  const selection = instance.getSelection()
  if (!model || !selection) return null
  const filePath = model.uri.fsPath
  return {
    text: model.getValueInRange(selection),
    filePath,
    fileUrl: model.uri.toString(),
    selection: {
      start: { line: selection.startLineNumber - 1, character: selection.startColumn - 1 },
      end: { line: selection.endLineNumber - 1, character: selection.endColumn - 1 },
      isEmpty: selection.isEmpty(),
    },
  }
}

/** Called by the editor on every cursor/selection change. */
export function trackSelection(instance: editor.ICodeEditor): void {
  current = selectionFromEditor(instance)
  if (current && !current.selection.isEmpty) latest = current
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    const snapshot = current
    if (!snapshot) return
    const serialized = JSON.stringify(snapshot)
    if (serialized === lastSent) return
    lastSent = serialized
    window.anycode.send('bridge:selectionChanged', snapshot)
  }, DEBOUNCE_MS)
}

export function currentSelection(): EditorSelection | null {
  return current
}

export function latestSelection(): EditorSelection | null {
  return latest ?? current
}

/** The active editor went away (tab closed, diff shown). */
export function clearCurrentSelection(): void {
  current = null
}
