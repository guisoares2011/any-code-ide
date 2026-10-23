import { useEffect, useMemo, useRef, useState } from 'react'
import * as monaco from 'monaco-editor'
import { basename, dirname, relativePath } from '@shared/paths'
import { requestReveal } from '../editor/documents'
import { useStore } from '../state/store'
import { openFile, workbench } from '../state/workbench'
import { Icon } from '../ui/Icon'
import { fileIconName } from '../ui/icons'
import { useListNavigation } from '../ui/useListNavigation'

type Row =
  | { kind: 'file'; path: string; count: number }
  | { kind: 'problem'; path: string; marker: monaco.editor.IMarker }

function readMarkers(): monaco.editor.IMarker[] {
  return monaco.editor
    .getModelMarkers({})
    .filter((m) => m.resource.scheme === 'file' && m.severity >= monaco.MarkerSeverity.Warning)
    .sort(
      (a, b) =>
        a.resource.fsPath.localeCompare(b.resource.fsPath) ||
        b.severity - a.severity ||
        a.startLineNumber - b.startLineNumber,
    )
}

function reveal(marker: monaco.editor.IMarker): void {
  requestReveal(marker.resource.fsPath, {
    startLineNumber: marker.startLineNumber,
    startColumn: marker.startColumn,
    endLineNumber: marker.endLineNumber,
    endColumn: marker.endColumn,
  })
  openFile(marker.resource.fsPath)
}

/** Problems of the open files, from the language servers' diagnostics. */
export function ProblemsView() {
  const project = useStore(workbench, (s) => s.project)
  const [markers, setMarkers] = useState(readMarkers)
  const [selected, setSelected] = useState(0)
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const subscription = monaco.editor.onDidChangeMarkers(() => setMarkers(readMarkers()))
    return () => subscription.dispose()
  }, [])

  const rows = useMemo(() => {
    const result: Row[] = []
    let current: string | null = null
    for (const marker of markers) {
      const path = marker.resource.fsPath
      if (path !== current) {
        current = path
        result.push({ kind: 'file', path, count: markers.filter((m) => m.resource.fsPath === path).length })
      }
      result.push({ kind: 'problem', path, marker })
    }
    return result
  }, [markers])

  const activate = (row: Row): void => {
    if (row.kind === 'problem') reveal(row.marker)
    else openFile(row.path)
  }
  useListNavigation(container, rows, selected, setSelected, activate)

  if (rows.length === 0) return <div className="empty-state">No problems in the open files.</div>
  return (
    <div className="tree" tabIndex={0} ref={container} data-focus-area="tree" role="tree" aria-label="Problems">
      {rows.map((row, index) => (
        <div
          key={row.kind === 'file' ? row.path : `${row.path}:${index}`}
          role="treeitem"
          aria-selected={index === selected}
          className={`tree-row${index === selected ? ' selected' : ''}`}
          style={{ paddingLeft: row.kind === 'file' ? 8 : 30 }}
          onMouseDown={() => setSelected(index)}
          onDoubleClick={() => activate(row)}
        >
          {row.kind === 'file' ? (
            <>
              <Icon name={fileIconName(basename(row.path))} />
              <span>{basename(row.path)}</span>
              <span className="hint">
                {project ? dirname(relativePath(project.root, row.path)) : dirname(row.path)} · {row.count}{' '}
                {row.count === 1 ? 'problem' : 'problems'}
              </span>
            </>
          ) : (
            <>
              <Icon name={row.marker.severity === monaco.MarkerSeverity.Error ? 'general/errorDialog' : 'general/warningDialog'} />
              <span className="problem-message">{row.marker.message.split('\n')[0]}</span>
              <span className="hint">
                {row.marker.source ? `${row.marker.source} ` : ''}:{row.marker.startLineNumber}
              </span>
            </>
          )}
        </div>
      ))}
    </div>
  )
}
