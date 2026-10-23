import { closeEditorTab } from '../editor/EditorArea'
import { saveAll } from '../editor/documents'
import type { ActionDefinition } from '../keymap/actions'
import { pushCurrentBranch } from '../state/git'
import { closeCurrentProject, pickAndOpenProject } from '../state/projects'
import {
  activateToolWindow,
  cycleProject,
  hideAllToolWindows,
  hideToolWindow,
  openPopup,
  requestFocus,
  selectAdjacentTab,
  showToolWindow,
  TOOL_WINDOWS,
  workbench,
  type ToolWindowId,
} from '../state/workbench'

/** The tool window containing the focused element, if any. */
export function focusedToolWindow(): ToolWindowId | null {
  const id = document.activeElement?.closest('[data-tool-window]')?.getAttribute('data-tool-window')
  return (TOOL_WINDOWS.find((t) => t.id === id)?.id ?? null) as ToolWindowId | null
}

export function workbenchActions(): ActionDefinition[] {
  const toolWindowActions: ActionDefinition[] = TOOL_WINDOWS.map((spec) => ({
    id: spec.activateActionId,
    perform: () => activateToolWindow(spec.id, focusedToolWindow() === spec.id),
  }))
  const inEditor = (c: { focusArea: string }) => c.focusArea === 'editor' && workbench.get().activeTab !== null

  return [
    ...toolWindowActions,
    { id: 'HideAllWindows', perform: hideAllToolWindows },
    {
      id: 'HideActiveWindow',
      isEnabled: () => focusedToolWindow() !== null,
      perform: () => {
        const id = focusedToolWindow()
        if (id) hideToolWindow(id)
        requestFocus('editor')
      },
    },
    { id: 'SearchEverywhere', perform: () => openPopup('SearchEverywhere') },
    { id: 'GotoFile', perform: () => openPopup('GotoFile') },
    { id: 'GotoAction', perform: () => openPopup('GotoAction') },
    { id: 'RecentFiles', perform: () => openPopup('RecentFiles') },
    { id: 'SaveAll', perform: () => void saveAll() },
    // ⌘K: the Commit tool window with the message field focused, like IntelliJ's non-modal commit.
    { id: 'CheckinProject', perform: () => showToolWindow('Commit') },
    { id: 'Vcs.Push', perform: () => void pushCurrentBranch() },
    { id: 'NextProjectWindow', isEnabled: () => workbench.get().projects.length > 1, perform: () => cycleProject(1) },
    { id: 'PreviousProjectWindow', isEnabled: () => workbench.get().projects.length > 1, perform: () => cycleProject(-1) },
    { id: '$LRU', text: 'Recent Projects', perform: () => openPopup('Projects') },
    { id: 'OpenFile', text: 'Open…', perform: () => void pickAndOpenProject() },
    { id: 'CloseProject', isEnabled: () => workbench.get().project !== null, perform: () => void closeCurrentProject() },
    {
      id: 'CloseContent',
      isEnabled: inEditor,
      perform: () => {
        const { tabs, activeTab } = workbench.get()
        const tab = tabs.find((t) => t.path === activeTab)
        if (tab) closeEditorTab(tab)
      },
    },
    { id: 'NextTab', isEnabled: inEditor, perform: () => selectAdjacentTab(1) },
    { id: 'PreviousTab', isEnabled: inEditor, perform: () => selectAdjacentTab(-1) },
  ]
}
