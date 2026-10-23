import { useEffect, useMemo, useRef, useState } from 'react'
import { basename, dirname } from '@shared/paths'
import { useActions } from '../keymap/service'
import { gitState } from '../state/git'
import { useStore } from '../state/store'
import { Icon } from '../ui/Icon'
import { fileIconName } from '../ui/icons'
import { workbench } from '../state/workbench'
import { showFileHistory } from './LogView'
import { canRollback, closeRollback, openRollback, performRollback, rollbackRequest } from './rollback'

/**
 * VCS actions available everywhere (Rollback, Show History) and IntelliJ's "Rollback Changes"
 * dialog.
 */
export function VcsActions() {
  const paths = useStore(rollbackRequest, (s) => s.paths)
  useActions(
    () => [
      { id: 'ChangesView.Revert', isEnabled: (c) => c.focusArea !== 'dialog' && canRollback(), perform: () => openRollback() },
      {
        id: 'Vcs.ShowTabbedFileHistory',
        isEnabled: () => gitState.get().status.repository && activeFile() !== undefined,
        perform: () => showFileHistory(activeFile()!),
      },
    ],
    [],
  )
  return paths ? <Dialog initial={paths} /> : null
}

/** The file of the active editor tab (or of a HEAD ↔ Local diff). */
function activeFile(): string | undefined {
  const { tabs, activeTab } = workbench.get()
  const tab = tabs.find((t) => t.path === activeTab)
  return tab?.kind === 'file' ? tab.path : tab?.filePath
}

function Dialog({ initial }: { initial: string[] }) {
  const status = useStore(gitState, (s) => s.status)
  const files = useMemo(() => status.files.filter((f) => f.kind !== 'untracked'), [status])
  const [checked, setChecked] = useState(() => new Set(initial))
  const [deleteAdded, setDeleteAdded] = useState(false)
  const [busy, setBusy] = useState(false)
  const confirmButton = useRef<HTMLButtonElement>(null)

  useEffect(() => confirmButton.current?.focus(), [])

  const selected = files.filter((f) => checked.has(f.path))
  const hasAdded = selected.some((f) => f.kind === 'added')
  const counts = new Map<string, number>()
  for (const f of selected) counts.set(f.kind, (counts.get(f.kind) ?? 0) + 1)
  const summary = [...counts].map(([kind, n]) => `${n} ${kind}`).join(', ')

  const confirm = async (): Promise<void> => {
    if (busy || selected.length === 0) return
    setBusy(true)
    const ok = await performRollback(
      selected.map((f) => f.path),
      deleteAdded,
    )
    setBusy(false)
    if (ok) closeRollback()
  }

  const state = useRef({ confirm })
  useEffect(() => {
    state.current = { confirm }
  })
  useActions(
    () => [
      { id: 'Popup.Cancel', isEnabled: (c) => c.focusArea === 'dialog', perform: closeRollback },
      { id: 'Popup.Confirm', isEnabled: (c) => c.focusArea === 'dialog', perform: () => void state.current.confirm() },
    ],
    [],
  )

  const toggle = (path: string, on: boolean): void =>
    setChecked((prev) => {
      const next = new Set(prev)
      if (on) next.add(path)
      else next.delete(path)
      return next
    })

  return (
    <div className="popup-backdrop" onMouseDown={closeRollback}>
      <div className="dialog rollback-dialog" role="dialog" aria-label="Rollback Changes" data-focus-area="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-title">Rollback Changes</div>
        <div className="rollback-list" role="tree" aria-label="Changes to roll back">
          {files.map((file) => (
            <label key={file.path} role="treeitem" className="tree-row">
              <input
                type="checkbox"
                aria-label={`Roll back ${file.relativePath}`}
                checked={checked.has(file.path)}
                onChange={(e) => toggle(file.path, e.target.checked)}
              />
              <Icon name={fileIconName(basename(file.path))} />
              <span className={`vcs-${file.kind}`}>{basename(file.path)}</span>
              <span className="hint">{dirname(`/${file.relativePath}`).slice(1)}</span>
            </label>
          ))}
        </div>
        <div className="rollback-options">
          <span className="hint">{selected.length === 0 ? 'No changes selected' : summary}</span>
          {hasAdded && (
            <label className="checkbox-field">
              <input type="checkbox" checked={deleteAdded} onChange={(e) => setDeleteAdded(e.target.checked)} />
              Delete local copies of the added files
            </label>
          )}
        </div>
        <div className="dialog-footer">
          <Icon name="vcs/revert" />
          <span className="toolbar-spacer" />
          <button className="button secondary" onClick={closeRollback}>
            Cancel
          </button>
          <button ref={confirmButton} className="button primary" disabled={busy || selected.length === 0} onClick={() => void confirm()}>
            Rollback
          </button>
        </div>
      </div>
    </div>
  )
}
