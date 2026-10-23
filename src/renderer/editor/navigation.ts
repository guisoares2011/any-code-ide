// Cross-file navigation from Monaco (go to definition, references, links): opens the target as a
// tab and reveals the position, instead of Monaco's default of doing nothing for other models.
import * as monaco from 'monaco-editor'
import { openFile } from '../state/workbench'
import { requestReveal } from './documents'

function toRange(target: monaco.IRange | monaco.IPosition | undefined): monaco.IRange | null {
  if (!target) return null
  if ('startLineNumber' in target) return target
  return { startLineNumber: target.lineNumber, startColumn: target.column, endLineNumber: target.lineNumber, endColumn: target.column }
}

let installed = false

export function installEditorOpener(): void {
  if (installed) return
  installed = true
  monaco.editor.registerEditorOpener({
    openCodeEditor(_source, resource, selectionOrPosition) {
      if (resource.scheme !== 'file') return false
      const range = toRange(selectionOrPosition)
      if (range) requestReveal(resource.fsPath, range)
      openFile(resource.fsPath)
      return true
    },
  })
}
