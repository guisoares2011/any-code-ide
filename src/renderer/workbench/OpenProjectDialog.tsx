import { useEffect, useRef } from 'react'
import { basename } from '@shared/paths'
import { shortcutFor, useActions } from '../keymap/service'
import { createStore, useStore } from '../state/store'
import { workbench } from '../state/workbench'

export type OpenTarget = 'this' | 'new' | 'tab'

interface Pending {
  path: string
  resolve: (target: OpenTarget | null) => void
}

const request = createStore<{ pending: Pending | null }>({ pending: null })

/**
 * The "Open Project" question of IntelliJ: New Tab adds a project tab to this window (like merged
 * project windows on macOS), New Window opens another window and This Window replaces the project.
 */
export function askOpenTarget(path: string): Promise<OpenTarget | null> {
  request.get().pending?.resolve(null)
  return new Promise((resolve) => request.set({ pending: { path, resolve } }))
}

function answer(target: OpenTarget | null): void {
  const { pending } = request.get()
  request.set({ pending: null })
  pending?.resolve(target)
}

export function OpenProjectDialog() {
  const pending = useStore(request, (s) => s.pending)
  const current = useStore(workbench, (s) => s.project)
  const confirmButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (pending) confirmButton.current?.focus()
  }, [pending])

  useActions(
    () => [
      { id: 'Popup.Cancel', isEnabled: (c) => c.focusArea === 'dialog' && request.get().pending !== null, perform: () => answer(null) },
      { id: 'Popup.Confirm', isEnabled: (c) => c.focusArea === 'dialog' && request.get().pending !== null, perform: () => answer('tab') },
    ],
    [],
  )

  if (!pending) return null
  const switcher = shortcutFor('NextProjectWindow')
  return (
    <div className="popup-backdrop" onMouseDown={() => answer(null)}>
      <div className="dialog open-project-dialog" role="dialog" aria-label="Open Project" data-focus-area="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-title">Open Project</div>
        <div className="dialog-body">
          <p>
            Where would you like to open <b>{basename(pending.path)}</b>?
          </p>
          <p className="hint">
            New Tab keeps <b>{current?.name}</b> open in another tab of this window{switcher ? ` (switch with ${switcher})` : ''}. This
            Window closes it.
          </p>
        </div>
        <div className="dialog-footer">
          <span className="toolbar-spacer" />
          <button className="button secondary" onClick={() => answer(null)}>
            Cancel
          </button>
          <button className="button secondary" onClick={() => answer('this')}>
            This Window
          </button>
          <button className="button secondary" onClick={() => answer('new')}>
            New Window
          </button>
          <button ref={confirmButton} className="button primary" onClick={() => answer('tab')}>
            New Tab
          </button>
        </div>
      </div>
    </div>
  )
}
