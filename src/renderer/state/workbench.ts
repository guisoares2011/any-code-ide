import type { ProjectInfo } from '@shared/ipc'
import { basename } from '@shared/paths'
import { createStore } from './store'

export type Anchor = 'left' | 'bottom' | 'right'

export type ToolWindowId = 'Project' | 'Commit' | 'Structure' | 'Version Control' | 'Problems View' | 'Terminal' | 'Run' | 'Notifications' | 'Maven'

export interface ToolWindowSpec {
  id: ToolWindowId
  anchor: Anchor
  /** Stripe title (toolwindow.stripe.<id>). */
  title: string
  /** expui icon name, 20x20 for the New UI stripes. */
  icon: string
  /** IntelliJ action that shows/focuses/hides it. */
  activateActionId: string
}

/**
 * Tool windows in the order of the New UI default layout (defaultToolWindowlayoutProvider.kt,
 * addPlatformDefaultsV2), limited to the ones AnyCode v1 implements; Run joins the bottom stripe.
 */
export const TOOL_WINDOWS: readonly ToolWindowSpec[] = [
  { id: 'Project', anchor: 'left', title: 'Project', icon: 'toolwindows/project@20x20', activateActionId: 'ActivateProjectToolWindow' },
  { id: 'Commit', anchor: 'left', title: 'Commit', icon: 'toolwindows/commit@20x20', activateActionId: 'ActivateCommitToolWindow' },
  { id: 'Structure', anchor: 'left', title: 'Structure', icon: 'toolwindows/structure@20x20', activateActionId: 'ActivateStructureToolWindow' },
  // Titled "Git" like IntelliJ's stripe in a git project.
  { id: 'Version Control', anchor: 'bottom', title: 'Git', icon: 'toolwindows/vcs@20x20', activateActionId: 'ActivateVersionControlToolWindow' },
  { id: 'Problems View', anchor: 'bottom', title: 'Problems', icon: 'toolwindows/problems@20x20', activateActionId: 'ActivateProblemsViewToolWindow' },
  { id: 'Terminal', anchor: 'bottom', title: 'Terminal', icon: 'toolwindow/terminal@20x20', activateActionId: 'ActivateTerminalToolWindow' },
  { id: 'Run', anchor: 'bottom', title: 'Run', icon: 'toolwindows/run@20x20', activateActionId: 'ActivateRunToolWindow' },
  { id: 'Notifications', anchor: 'right', title: 'Notifications', icon: 'toolwindows/notifications@20x20', activateActionId: 'ActivateNotificationsToolWindow' },
  { id: 'Maven', anchor: 'right', title: 'Maven', icon: 'toolwindow/maven@20x20', activateActionId: 'ActivateMavenToolWindow' },
]

export const toolWindow = (id: ToolWindowId): ToolWindowSpec => TOOL_WINDOWS.find((t) => t.id === id)!

export interface EditorTab {
  /** Unique key: the file path, or `diff:<tab name>` for a Claude Code diff. */
  path: string
  name: string
  /** file: an editor; diff: a change proposed by Claude; vcs-diff: HEAD against the local file, or a commit's change. */
  kind: 'file' | 'diff' | 'vcs-diff'
  /** For vcs-diff tabs, the file being compared. */
  filePath?: string
  /** For a commit's change: the commit (compared with its first parent) and the absolute path before a rename. */
  revision?: string
  originalPath?: string
}

export const DIFF_TAB_PREFIX = 'diff:'
export const diffTabKey = (tabName: string): string => DIFF_TAB_PREFIX + tabName
export const vcsDiffTabKey = (path: string): string => `vcsdiff:${path}`

export type PopupKind = 'GotoFile' | 'GotoAction' | 'SearchEverywhere' | 'RecentFiles' | 'ChooseRunConfiguration' | 'Projects' | 'Branches'

export type FocusTarget = 'editor' | ToolWindowId

export interface Caret {
  line: number
  column: number
}

export interface WorkbenchState {
  /** The project shown in the window. */
  project: ProjectInfo | null
  /** The projects of this window (attached), in opening order; each has its own terminals and runs. */
  projects: ProjectInfo[]
  visible: Record<Anchor, ToolWindowId | null>
  /** Panel sizes in px: width for left/right, height for bottom. */
  sizes: Record<Anchor, number>
  tabs: EditorTab[]
  activeTab: string | null
  dirty: ReadonlySet<string>
  recentFiles: string[]
  popup: PopupKind | null
  focus: { target: FocusTarget; seq: number }
  caret: Caret | null
}

const MAX_RECENT_FILES = 50

export const workbench = createStore<WorkbenchState>({
  project: null,
  projects: [],
  // AI-first: the terminal (with claude) is the default bottom panel.
  visible: { left: 'Project', bottom: 'Terminal', right: null },
  sizes: { left: 300, bottom: 320, right: 320 },
  tabs: [],
  activeTab: null,
  dirty: new Set(),
  recentFiles: [],
  popup: null,
  focus: { target: 'editor', seq: 0 },
  caret: null,
})

/** The file an editor tab shows (the compared file for a diff), if any. */
export function tabFile(tab: EditorTab): string | undefined {
  return tab.kind === 'file' ? tab.path : tab.filePath
}

const isUnder = (root: string, path: string | undefined): boolean => path !== undefined && (path === root || path.startsWith(`${root}/`))

/**
 * Makes another attached project the current one: the toolbar, terminal, git and run follow it.
 * Tabs, tool window layout and recent files belong to the window, as in IntelliJ, so nothing else changes.
 */
export function switchProject(root: string, focusEditor = true): void {
  const s = workbench.get()
  const target = s.projects.find((p) => p.root === root)
  if (!target || s.project?.root === root) return
  workbench.set({ project: target, popup: null })
  if (focusEditor) requestFocus('editor')
}

/** Makes the project of a tab's file current (the deepest root wins for nested projects). */
export function showTabProject(tabPath: string): void {
  const s = workbench.get()
  const tab = s.tabs.find((t) => t.path === tabPath)
  const file = tab && tabFile(tab)
  const owner = s.projects.filter((p) => isUnder(p.root, file)).sort((a, b) => b.root.length - a.root.length)[0]
  if (owner && owner.root !== s.project?.root) switchProject(owner.root, false)
}

/** Adds a project the main process opened and shows it. */
export function addProject(project: ProjectInfo): void {
  workbench.set((s) => (s.projects.some((p) => p.root === project.root) ? {} : { projects: [...s.projects, project] }))
  switchProject(project.root)
}

/** Removes a project and closes its tabs; returns the project now shown, if any. */
export function removeProject(root: string): ProjectInfo | null {
  const s = workbench.get()
  const index = s.projects.findIndex((p) => p.root === root)
  if (index < 0) return s.project
  const projects = s.projects.filter((p) => p.root !== root)
  const tabs = s.tabs.filter((t) => !isUnder(root, tabFile(t)))
  const activeTab = tabs.some((t) => t.path === s.activeTab) ? s.activeTab : (tabs[tabs.length - 1]?.path ?? null)
  const recentFiles = s.recentFiles.filter((p) => !isUnder(root, p))
  const next = s.project?.root === root ? (projects[Math.min(index, projects.length - 1)] ?? null) : s.project
  workbench.set({ projects, project: next, tabs, activeTab, recentFiles, ...(activeTab === s.activeTab ? {} : { caret: null }) })
  return next
}

/** Cycles through the projects attached to this window; with only one, through the windows. */
export function cycleProject(delta: 1 | -1): void {
  const { projects, project } = workbench.get()
  if (projects.length < 2 || !project) {
    window.anycode.send('window:cycle', delta)
    return
  }
  const index = projects.findIndex((p) => p.root === project.root)
  switchProject(projects[(index + delta + projects.length) % projects.length]!.root)
}

export function requestFocus(target: FocusTarget): void {
  workbench.set((s) => ({ focus: { target, seq: s.focus.seq + 1 } }))
}

export function showToolWindow(id: ToolWindowId, focus = true): void {
  const { anchor } = toolWindow(id)
  workbench.set((s) => ({ visible: { ...s.visible, [anchor]: id } }))
  if (focus) requestFocus(id)
}

export function hideToolWindow(id: ToolWindowId): void {
  const { anchor } = toolWindow(id)
  workbench.set((s) => (s.visible[anchor] === id ? { visible: { ...s.visible, [anchor]: null } } : {}))
}

/**
 * ActivateToolWindowAction: hidden -> show and focus; visible but unfocused -> focus;
 * visible and focused -> hide and return focus to the editor.
 */
export function activateToolWindow(id: ToolWindowId, hasFocus: boolean): void {
  const { anchor } = toolWindow(id)
  const visible = workbench.get().visible[anchor] === id
  if (visible && hasFocus) {
    hideToolWindow(id)
    requestFocus('editor')
  } else showToolWindow(id)
}

export function hideAllToolWindows(): void {
  workbench.set({ visible: { left: null, bottom: null, right: null } })
  requestFocus('editor')
}

export function setPanelSize(anchor: Anchor, size: number): void {
  workbench.set((s) => ({ sizes: { ...s.sizes, [anchor]: Math.round(size) } }))
}

export function openFile(path: string, focus = true): void {
  workbench.set((s) => ({
    tabs: s.tabs.some((t) => t.path === path) ? s.tabs : [...s.tabs, { path, name: basename(path), kind: 'file' as const }],
    activeTab: path,
    recentFiles: [path, ...s.recentFiles.filter((p) => p !== path)].slice(0, MAX_RECENT_FILES),
  }))
  if (focus) requestFocus('editor')
}

/** Opens (or re-activates) a diff tab; `name` is shown on the tab. */
export function openDiffTab(tabName: string, name: string): void {
  const path = diffTabKey(tabName)
  workbench.set((s) => ({
    tabs: s.tabs.some((t) => t.path === path) ? s.tabs : [...s.tabs, { path, name, kind: 'diff' as const }],
    activeTab: path,
  }))
  requestFocus('editor')
}

/** Opens (or re-activates) the HEAD vs local diff of a file. */
export function openVcsDiffTab(path: string): void {
  const key = vcsDiffTabKey(path)
  workbench.set((s) => ({
    tabs: s.tabs.some((t) => t.path === key)
      ? s.tabs
      : [...s.tabs, { path: key, name: `${basename(path)} (HEAD ↔ Local)`, kind: 'vcs-diff' as const, filePath: path }],
    activeTab: key,
  }))
  requestFocus('editor')
}

/** Opens (or re-activates) the change a commit made to a file: `<hash>^` ↔ `<hash>`, both read-only. */
export function openCommitDiffTab(hash: string, path: string, originalPath?: string): void {
  const key = `vcsdiff:${hash}:${path}`
  workbench.set((s) => ({
    tabs: s.tabs.some((t) => t.path === key)
      ? s.tabs
      : [
          ...s.tabs,
          { path: key, name: `${basename(path)} (${hash.slice(0, 8)})`, kind: 'vcs-diff' as const, filePath: path, revision: hash, ...(originalPath ? { originalPath } : {}) },
        ],
    activeTab: key,
  }))
  requestFocus('editor')
}

/** Opens a file tab without moving focus or changing the active tab (openFile makeFrontmost=false). */
export function openFileInBackground(path: string): void {
  workbench.set((s) =>
    s.tabs.some((t) => t.path === path)
      ? {}
      : { tabs: [...s.tabs, { path, name: basename(path), kind: 'file' as const }], activeTab: s.activeTab ?? path },
  )
}

export function closeTab(path: string): void {
  workbench.set((s) => {
    const index = s.tabs.findIndex((t) => t.path === path)
    if (index < 0) return {}
    const tabs = s.tabs.filter((t) => t.path !== path)
    const activeTab =
      s.activeTab === path ? (tabs[Math.min(index, tabs.length - 1)]?.path ?? null) : s.activeTab
    const dirty = new Set(s.dirty)
    dirty.delete(path)
    return { tabs, activeTab, dirty }
  })
}

export function selectAdjacentTab(delta: 1 | -1): void {
  workbench.set((s) => {
    if (s.tabs.length === 0) return {}
    const index = s.tabs.findIndex((t) => t.path === s.activeTab)
    const next = s.tabs[(index + delta + s.tabs.length) % s.tabs.length]!
    return { activeTab: next.path }
  })
  requestFocus('editor')
}

export function setDirty(path: string, dirty: boolean): void {
  workbench.set((s) => {
    if (s.dirty.has(path) === dirty) return {}
    const next = new Set(s.dirty)
    if (dirty) next.add(path)
    else next.delete(path)
    return { dirty: next }
  })
}

export function openPopup(popup: PopupKind): void {
  workbench.set({ popup })
}

export function closePopup(): void {
  workbench.set({ popup: null })
}
