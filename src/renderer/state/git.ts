// Git status of the project, refreshed on file changes (including .git/index and HEAD, which the
// agent's commits touch) and after AnyCode's own git commands.
import type { GitFileStatus, GitStatus } from '@shared/git'
import { notify } from './notifications'
import { createStore } from './store'
import { workbench } from './workbench'

const REFRESH_DELAY_MS = 300

export const gitState = createStore<{ status: GitStatus; byPath: ReadonlyMap<string, GitFileStatus> }>({
  status: { repository: false, branch: null, files: [] },
  byPath: new Map(),
})

let timer: ReturnType<typeof setTimeout> | null = null
let installed = false

/**
 * `status` is the current project's (Commit, branch widget); `byPath` covers every project of the
 * window, so the Project view and tabs color the files of attached projects too.
 */
export async function refreshGit(): Promise<void> {
  const { project, projects } = workbench.get()
  if (!project) return
  const others = projects.filter((p) => p.root !== project.root)
  const [status, ...rest] = await Promise.all([project, ...others].map((p) => window.anycode.invoke('git:status', p.root)))
  if (!status || workbench.get().project?.root !== project.root) return
  const files = [status, ...rest].flatMap((s) => s.files)
  gitState.set({ status, byPath: new Map(files.map((f) => [f.path, f])) })
}

function scheduleRefresh(): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void refreshGit()
  }, REFRESH_DELAY_MS)
}

export function installGitStatus(): void {
  if (installed) return
  installed = true
  window.anycode.on('fs:changed', scheduleRefresh)
  // A different project is shown: its status replaces the previous one.
  let root = workbench.get().project?.root
  let count = workbench.get().projects.length
  workbench.subscribe(() => {
    const { project, projects } = workbench.get()
    if (project?.root === root && projects.length === count) return
    // Switching follows the active tab, so the old status stays until the new one arrives (no flicker).
    root = project?.root
    count = projects.length
    void refreshGit()
  })
  void refreshGit()
}

export async function commitFiles(message: string, paths: string[], pushAfter: boolean): Promise<boolean> {
  const root = workbench.get().project?.root
  if (!root) return false
  const result = await window.anycode.invoke('git:commit', root, message, paths)
  await refreshGit()
  if (!result.ok) {
    notify('error', 'Commit failed', result.output)
    return false
  }
  const summary = result.output.split('\n')[0] ?? ''
  notify('info', `Committed ${paths.length} ${paths.length === 1 ? 'file' : 'files'}`, summary)
  if (pushAfter) await pushCurrentBranch()
  return true
}

export async function pushCurrentBranch(): Promise<void> {
  const root = workbench.get().project?.root
  if (!root) return
  const result = await window.anycode.invoke('git:push', root)
  if (result.ok) notify('info', 'Pushed', result.output.split('\n').slice(-1)[0] ?? '')
  else notify('error', 'Push failed', result.output)
}

/** Git.Branches popup: checks out a branch (or creates one) and reports git's error, if any. */
export async function checkoutBranch(branch: string, mode: 'local' | 'remote' | 'create'): Promise<void> {
  const root = workbench.get().project?.root
  if (!root) return
  const result = await window.anycode.invoke('git:checkout', root, branch, mode)
  await refreshGit()
  if (!result.ok) notify('error', mode === 'create' ? `Could not create branch ${branch}` : `Could not check out ${branch}`, result.output)
  else notify('info', mode === 'create' ? `Created and checked out ${branch}` : `Checked out ${gitState.get().status.branch ?? branch}`, '')
}
