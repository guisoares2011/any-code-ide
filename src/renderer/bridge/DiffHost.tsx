import { useEffect, useRef } from 'react'
import type { editor } from 'monaco-editor'
import { relativePath } from '@shared/paths'
import { languageForFile, setupMonaco, THEME_NAME } from '../editor/monacoSetup'
import { performAction, shortcutFor, useActions } from '../keymap/service'
import { useStore } from '../state/store'
import { workbench } from '../state/workbench'
import { clearCurrentSelection } from './selection'
import { acceptDiff, pendingDiffByKey, rejectDiff, type PendingDiff } from './diffs'
import { editorFont } from '../state/settings'

let counter = 0

/** Side-by-side review of a change Claude Code proposes; the right side stays editable. */
export function DiffHost({ tabKey }: { tabKey: string }) {
  const diff = pendingDiffByKey(tabKey)
  if (!diff) return <div className="empty-state">This diff was already resolved.</div>
  return <DiffView key={tabKey} diff={diff} />
}

function DiffView({ diff }: { diff: PendingDiff }) {
  const container = useRef<HTMLDivElement>(null)
  const modified = useRef<editor.ITextModel | null>(null)
  const project = useStore(workbench, (s) => s.project)

  useEffect(() => {
    const monaco = setupMonaco()
    if (!container.current) return
    clearCurrentSelection()
    const language = languageForFile(diff.newPath)
    const id = ++counter
    const originalModel = monaco.editor.createModel(diff.original, language, monaco.Uri.parse(`anycode-diff://${id}/original`))
    const modifiedModel = monaco.editor.createModel(diff.proposed, language, monaco.Uri.parse(`anycode-diff://${id}/proposed`))
    modified.current = modifiedModel
    const diffEditor = monaco.editor.createDiffEditor(container.current, {
      theme: THEME_NAME,
      automaticLayout: true,
      originalEditable: false,
      renderSideBySide: true,
      fontFamily: 'JetBrains Mono',
      ...editorFont(),
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
    })
    diffEditor.setModel({ original: originalModel, modified: modifiedModel })
    diffEditor.getModifiedEditor().focus()
    return () => {
      diffEditor.dispose()
      originalModel.dispose()
      modifiedModel.dispose()
      modified.current = null
    }
  }, [diff])

  const accept = (): void => acceptDiff(diff.tabName, modified.current?.getValue() ?? diff.proposed)

  // ⌘S accepts, like saving the proposed buffer in the reference integrations.
  useActions(
    () => [
      { id: 'SaveAll', isEnabled: (c) => c.focusArea === 'editor', perform: accept },
      { id: 'CloseContent', isEnabled: (c) => c.focusArea === 'editor', perform: () => rejectDiff(diff.tabName) },
    ],
    [diff],
  )

  const where = project ? relativePath(project.root, diff.newPath) : diff.newPath
  return (
    <div className="diff-view">
      <div className="diff-toolbar">
        <span className="diff-title">
          Claude proposes {diff.isNewFile ? 'a new file' : 'changes to'} <strong>{where}</strong>
        </span>
        <button className="button secondary" onClick={() => rejectDiff(diff.tabName)}>
          Reject
        </button>
        <button className="button primary" title={`Accept (${shortcutFor('SaveAll') ?? ''})`} onClick={() => performAction('SaveAll')}>
          Accept
        </button>
      </div>
      <div className="diff-editor" ref={container} />
    </div>
  )
}
