import { closeEditorTab } from '../editor/EditorArea'
import { saveAll } from '../editor/documents'
import type { ActionDefinition } from '../keymap/actions'
import { gitState, pushCurrentBranch } from '../state/git'
import { closeCurrentProject, mergeAllProjectWindows, moveProjectTabToNewWindow, pickAndOpenProject } from '../state/projects'
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
    // The branch widget's popup (git4idea's Git.Branches; no default shortcut on macOS).
    { id: 'Git.Branches', text: 'Branches…', isEnabled: () => gitState.get().status.repository, perform: () => openPopup('Branches') },
    // Window menu of IntelliJ on macOS: project windows merged into tabs, and back.
    { id: 'MergeAllWindowsAction', perform: () => void mergeAllProjectWindows() },
    {
      id: 'AnyCode.MoveTabToNewWindow',
      text: 'Move Tab to New Window',
      isEnabled: () => workbench.get().projects.length > 1,
      perform: () => void moveProjectTabToNewWindow(),
    },
    { id: 'NextProjectWindow', perform: () => cycleProject(1) },
    { id: 'PreviousProjectWindow', perform: () => cycleProject(-1) },
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
