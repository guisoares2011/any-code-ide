import { useEffect, useRef, useState } from 'react'
import { relativePath } from '@shared/paths'
import { openDocument } from '../editor/documents'
import { languageForFile, setupMonaco, THEME_NAME } from '../editor/monacoSetup'
import { useStore } from '../state/store'
import { workbench } from '../state/workbench'
import { editorFont } from '../state/settings'

let counter = 0

interface Props {
  path: string
  /** A commit whose change to the file is shown; absent for HEAD ↔ Local. */
  revision?: string | undefined
  /** The file's absolute path in the parent commit when the commit renamed it. */
  originalPath?: string | undefined
}

/**
 * HEAD (left, read-only) against the working copy (right). The right side is the file's own
 * document, so edits there are edits to the file and SaveAll writes them. With a revision, the
 * commit's parent against the commit, both read-only.
 */
export function VcsDiffHost({ path, revision, originalPath }: Props) {
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
      ...editorFont(),
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
    })
    const owned: { dispose(): void }[] = []
    const show = async (rev: string, file: string): Promise<string> => (await window.anycode.invoke('git:show', root, rev, file)) ?? ''
    if (revision) {
      void (async () => {
        const [before, after] = await Promise.all([show(`${revision}^`, originalPath ?? path), show(revision, path)])
        if (disposed) return
        const original = monaco.editor.createModel(before, language, monaco.Uri.parse(`anycode-head://${id}/parent`))
        const modified = monaco.editor.createModel(after, language, monaco.Uri.parse(`anycode-head://${id}/commit`))
        owned.push(original, modified)
        diffEditor.updateOptions({ readOnly: true })
        diffEditor.setModel({ original, modified })
      })()
      return () => {
        disposed = true
        diffEditor.dispose()
        owned.forEach((m) => m.dispose())
      }
    }
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
  }, [path, revision, originalPath])

  return (
    <div className="diff-view">
      <div className="diff-toolbar">
        <span className="diff-title">
          <strong>{project ? relativePath(project.root, path) : path}</strong> · {revision ? `${revision.slice(0, 8)}^ ↔ ${revision.slice(0, 8)}` : 'HEAD ↔ Local'}
        </span>
      </div>
      {error ? <div className="empty-state">{error}</div> : <div className="diff-editor" ref={container} />}
    </div>
  )
}
