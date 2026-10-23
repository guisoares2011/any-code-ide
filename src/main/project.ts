import { statSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ProjectInfo } from '@shared/ipc'
import { basename, isInside } from '@shared/paths'

const roots = new Set<string>()

function asProject(path: string): ProjectInfo | null {
  try {
    if (!statSync(path).isDirectory()) return null
  } catch {
    return null
  }
  return { root: path, name: basename(path) }
}

/**
 * The project named on the command line (`--project=<dir>`) or in ANYCODE_PROJECT, else the working
 * directory when the app was started from a terminal inside a project. An app opened from the
 * Dock or Finder has `/` as working directory and gets null: the last session's projects reopen.
 */
export function explicitProject(argv: readonly string[], env: NodeJS.ProcessEnv, cwd: string, home: string): string | null {
  const fromArgs = argv.find((arg) => arg.startsWith('--project='))?.slice('--project='.length)
  const chosen = fromArgs ?? env.ANYCODE_PROJECT
  if (chosen) return resolve(cwd, chosen)
  return cwd === '/' || resolve(cwd) === resolve(home) ? null : resolve(cwd)
}

/** Adds a directory to the opened projects, the roots file access is confined to. */
export function openProject(path: string): ProjectInfo | null {
  const project = asProject(resolve(path))
  if (project) roots.add(project.root)
  return project
}

export function closeProject(root: string): void {
  roots.delete(resolve(root))
}

export function openRoots(): string[] {
  return [...roots]
}

/** Throws unless `path` lies inside one of the opened project roots. */
export function assertInsideProject(path: string): string {
  const absolute = resolve(path)
  for (const root of roots) {
    if (isInside(root, absolute)) return absolute
  }
  throw new Error(`Path outside of the opened projects: ${absolute}`)
}
