// Markdown in the editor: a "Run in Terminal" CodeLens above each shell block, like the run gutter
// icon of IntelliJ's Markdown plugin.
import * as monaco from 'monaco-editor'
import { dirname } from '@shared/paths'
import { runInNewTerminal } from '../terminal/TerminalView'
import { findShellFences } from './shellFences'

const RUN_COMMAND = 'anycode.markdown.runShellBlock'
let installed = false

export function installMarkdownSupport(): void {
  if (installed) return
  installed = true
  monaco.editor.registerCommand(RUN_COMMAND, (_accessor, path: string, command: string) => {
    void runInNewTerminal(command, dirname(path))
  })
  monaco.languages.registerCodeLensProvider('markdown', {
    provideCodeLenses(model) {
      if (model.uri.scheme !== 'file') return { lenses: [], dispose: () => undefined }
      const lenses = findShellFences(model.getValue())
        .filter((fence) => fence.command !== '')
        .map((fence) => ({
          range: new monaco.Range(fence.startLine + 1, 1, fence.startLine + 1, 1),
          command: { id: RUN_COMMAND, title: '▶ Run in Terminal', arguments: [model.uri.fsPath, fence.command] },
        }))
      return { lenses, dispose: () => undefined }
    },
  })
}
