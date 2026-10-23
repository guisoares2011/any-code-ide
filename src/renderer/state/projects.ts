// Opening, switching and closing projects in the single window.
import { closeProjectSessions } from '../terminal/ptySessions'
import { forgetAgent, resumeAgent } from '../terminal/TerminalView'
import { askOpenTarget } from '../workbench/OpenProjectDialog'
import { notify } from './notifications'
import { addProject, removeProject, switchProject, workbench } from './workbench'

export async function openProjectPath(path: string): Promise<boolean> {
  // Already open in another window: that window comes to the front, as in IntelliJ.
  if (await window.anycode.invoke('project:focusIfOpen', path)) return true
  const open = workbench.get().projects.find((p) => p.root === path)
  if (open) {
    switchProject(open.root)
    return true
  }
  // With a project already open, ask like IntelliJ: a new tab, a new window, or this window.
  const previous = workbench.get().project?.root
  const target = previous ? await askOpenTarget(path) : 'tab'
  if (!target) return false
  if (target === 'new') {
    const opened = await window.anycode.invoke('project:openWindow', path)
    if (!opened) notify('error', 'Cannot open project', `${path} is not a directory.`)
    return opened
  }
  const project = await window.anycode.invoke('project:open', path)
  if (!project) {
    notify('error', 'Cannot open project', `${path} is not a directory.`)
    return false
  }
  addProject(project)
  if (target === 'this' && previous) await closeProjectTab(previous)
  return true
}

/** File > Open… : the native folder picker (not available in headless runs). */
export async function pickAndOpenProject(): Promise<void> {
  const path = await window.anycode.invoke('project:pickFolder')
  if (path) await openProjectPath(path)
}

/** CloseProject: stops the project's terminals and runs and shows the next open project. */
export async function closeCurrentProject(): Promise<void> {
  const root = workbench.get().project?.root
  if (root) await closeProjectTab(root)
}

/** Closes a project tab: its terminals and runs stop and the next tab is shown. */
export async function closeProjectTab(root: string): Promise<void> {
  closeProjectSessions(root)
  forgetAgent(root)
  removeProject(root)
  await window.anycode.invoke('project:close', root)
}

/** MergeAllWindowsAction: every other window's projects become tabs here, the shown tab unchanged. */
export async function mergeAllProjectWindows(): Promise<void> {
  for (const project of await window.anycode.invoke('window:mergeAll')) {
    resumeAgent(project.root)
    addProject(project, false)
  }
}

/** Move Tab to New Window: the current project tab leaves for its own window (its agent resumes there). */
export async function moveProjectTabToNewWindow(): Promise<void> {
  const root = workbench.get().project?.root
  if (!root || workbench.get().projects.length < 2) return
  closeProjectSessions(root)
  forgetAgent(root)
  removeProject(root)
  await window.anycode.invoke('project:moveToNewWindow', root)
}

/** The open project containing a path (the deepest root wins for nested projects). */
export function projectRootOf(path: string): string | undefined {
  return workbench
    .get()
    .projects.map((p) => p.root)
    .filter((root) => path === root || path.startsWith(`${root}/`))
    .sort((a, b) => b.length - a.length)[0]
}
