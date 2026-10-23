import { useEffect, useRef, useState } from 'react'
import { relativePath } from '@shared/paths'
import { openDocument } from '../editor/documents'
import { languageForFile, setupMonaco, THEME_NAME } from '../editor/monacoSetup'
import { useStore } from '../state/store'
import { workbench } from '../state/workbench'

let counter = 0

/**
 * HEAD (left, read-only) against the working copy (right). The right side is the file's own
 * document, so edits there are edits to the file and SaveAll writes them.
 */
export function VcsDiffHost({ path }: { path: string }) {
  const container = useRef<HTMLDivElement>(null)
  const project = useStore(workbench, (s) => s.project)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const monaco = setupMonaco()
    const root = workbench.get().project?.root
    if (!container.current || !root) return
    let disposed = false
    const id = ++counter
    const language = languageForFile(path)
    const diffEditor = monaco.editor.createDiffEditor(container.current, {
      theme: THEME_NAME,
      automaticLayout: true,
      originalEditable: false,
      renderSideBySide: true,
      fontFamily: 'JetBrains Mono',
      fontSize: 13,
      lineHeight: 20,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
    })
    const owned: { dispose(): void }[] = []
    void (async () => {
      const head = (await window.anycode.invoke('git:headContent', root, path)) ?? ''
      const document = await openDocument(path)
      if (disposed) return
      const original = monaco.editor.createModel(head, language, monaco.Uri.parse(`anycode-head://${id}/head`))
      owned.push(original)
      let modified
      if (document.kind === 'text') modified = document.model
      else if (document.kind === 'error') {
        // Deleted in the working copy: compare with an empty side.
        modified = monaco.editor.createModel('', language, monaco.Uri.parse(`anycode-head://${id}/deleted`))
        owned.push(modified)
      } else {
        setError(`This file is ${document.kind === 'binary' ? 'binary' : 'too large'}.`)
        return
      }
      diffEditor.setModel({ original, modified })
    })()
    return () => {
      disposed = true
      diffEditor.dispose()
      owned.forEach((m) => m.dispose())
    }
  }, [path])

  return (
    <div className="diff-view">
      <div className="diff-toolbar">
        <span className="diff-title">
          <strong>{project ? relativePath(project.root, path) : path}</strong> · HEAD ↔ Local
        </span>
      </div>
      {error ? <div className="empty-state">{error}</div> : <div className="diff-editor" ref={container} />}
    </div>
  )
}
