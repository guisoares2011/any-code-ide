// Rollback (ChangesView.Revert, ⌥⌘Z): which changes it starts with and what it does once confirmed.
import { revertDocuments } from '../editor/documents'
import { gitState, refreshGit } from '../state/git'
import { notify } from '../state/notifications'
import { createStore } from '../state/store'
import { workbench } from '../state/workbench'

/** The open Rollback dialog: the changes checked when it opened, or null when closed. */
export const rollbackRequest = createStore<{ paths: string[] | null }>({ paths: null })

/** Changes selected in the Commit tool window, kept by CommitView. */
export const changesSelection = createStore<{ paths: string[] }>({ paths: [] })

const trackedChanges = (): string[] => gitState.get().status.files.filter((f) => f.kind !== 'untracked').map((f) => f.path)

/**
 * The changes Rollback applies to, like IntelliJ's VCS context: the selection in the Commit tool
 * window when it has focus, the file of the active editor when it has changes, otherwise all.
 */
export function rollbackContext(): string[] {
  const tracked = trackedChanges()
  const active = document.activeElement
  if (active?.closest('.commit-view')) {
    const selected = changesSelection.get().paths.filter((p) => tracked.includes(p))
    if (selected.length > 0) return selected
  } else if (active?.closest('[data-focus-area="editor"]')) {
    const tab = workbench.get().tabs.find((t) => t.path === workbench.get().activeTab)
    const file = tab?.kind === 'vcs-diff' ? tab.filePath : tab?.path
    if (file && tracked.includes(file)) return [file]
  }
  return tracked
}

export const canRollback = (): boolean => trackedChanges().length > 0

export function openRollback(paths = rollbackContext()): void {
  if (paths.length > 0) rollbackRequest.set({ paths })
}

export function closeRollback(): void {
  rollbackRequest.set({ paths: null })
}

export async function performRollback(paths: string[], deleteAdded: boolean): Promise<boolean> {
  const root = workbench.get().project?.root
  if (!root || paths.length === 0) return false
  const result = await window.anycode.invoke('git:rollback', root, paths, deleteAdded)
  await refreshGit()
  if (!result.ok) {
    notify('error', 'Rollback failed', result.output)
    return false
  }
  await revertDocuments(paths)
  return true
}
