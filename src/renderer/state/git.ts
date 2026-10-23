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

export async function refreshGit(): Promise<void> {
  const root = workbench.get().project?.root
  if (!root) return
  const status = await window.anycode.invoke('git:status', root)
  gitState.set({ status, byPath: new Map(status.files.map((f) => [f.path, f])) })
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
  workbench.subscribe(() => {
    const next = workbench.get().project?.root
    if (next === root) return
    root = next
    gitState.set({ status: { repository: false, branch: null, files: [] }, byPath: new Map() })
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
