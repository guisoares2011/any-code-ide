// Recursive file watching of project roots (fs.watch is recursive on macOS), batched and filtered,
// so the renderer can reload documents and tree nodes the agent changed on disk.
import { watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'

const IGNORED_SEGMENTS = new Set(['.git', 'node_modules', 'out', 'dist', 'build', '.gradle', 'target', '.idea'])
const BATCH_MS = 150

/** Git metadata that signals commits, branch switches and staging, so status can refresh. */
const GIT_SIGNALS = /^\.git\/(index|HEAD|refs\/heads\/.+)$/

export function isIgnoredChange(relativePath: string): boolean {
  if (GIT_SIGNALS.test(relativePath)) return false
  return relativePath.split('/').some((segment) => IGNORED_SEGMENTS.has(segment))
}

export function watchProject(root: string, onChange: (paths: string[]) => void): () => void {
  let batch = new Set<string>()
  let timer: NodeJS.Timeout | null = null
  let watcher: FSWatcher
  try {
    watcher = watch(root, { recursive: true }, (_event, file) => {
      if (!file || isIgnoredChange(file.toString())) return
      batch.add(join(root, file.toString()))
      timer ??= setTimeout(() => {
        const paths = [...batch]
        batch = new Set()
        timer = null
        onChange(paths)
      }, BATCH_MS)
    })
  } catch {
    return () => undefined
  }
  watcher.on('error', () => watcher.close())
  return () => {
    if (timer) clearTimeout(timer)
    watcher.close()
  }
}
