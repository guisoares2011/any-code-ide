import { cp, mkdir, open, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { shell } from 'electron'
import type { DirEntry, FileContent } from '@shared/ipc'
import { isInside } from '@shared/paths'
import { listProjectFiles } from './fileIndex'
import { handle } from './ipc'
import { assertInsideProject } from './project'

const MAX_TEXT_BYTES = 5 * 1024 * 1024
const BINARY_SNIFF_BYTES = 8000

/**
 * IntelliJ's default "Ignored files and folders" (FileTypeManager): never shown in the project
 * tree. `*~` covers editor backup files.
 */
const IGNORED_NAMES = new Set(['.DS_Store', '.git', '.hg', '.svn', 'CVS', '__pycache__', '_svn', 'vssver.scc', 'vssver2.scc'])
const IGNORED_SUFFIXES = ['.pyc', '.pyo', '.rbc', '.yarb', '~']

export const isIgnoredName = (name: string): boolean => IGNORED_NAMES.has(name) || IGNORED_SUFFIXES.some((suffix) => name.endsWith(suffix))

export async function readDirEntries(dir: string): Promise<DirEntry[]> {
  const entries = (await readdir(dir, { withFileTypes: true })).filter((entry) => !isIgnoredName(entry.name))
  return entries.map((entry) => ({
    name: entry.name,
    path: join(dir, entry.name),
    kind: entry.isDirectory() ? 'directory' : entry.isSymbolicLink() ? 'symlink' : 'file',
  }))
}

export async function readFileContent(path: string): Promise<FileContent> {
  const { size } = await stat(path)
  if (size > MAX_TEXT_BYTES) return { kind: 'too-large', size }
  const handleRef = await open(path, 'r')
  try {
    const buffer = await handleRef.readFile()
    // Same heuristic as git: a NUL byte in the first chunk means binary.
    if (buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0)) return { kind: 'binary', size }
    return { kind: 'text', content: buffer.toString('utf8') }
  } finally {
    await handleRef.close()
  }
}

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

export async function readImageDataUrl(path: string): Promise<string | null> {
  const type = IMAGE_TYPES[extname(path).toLowerCase()]
  if (!type) return null
  try {
    if ((await stat(path)).size > MAX_TEXT_BYTES) return null
    const handleRef = await open(path, 'r')
    try {
      return `data:${type};base64,${(await handleRef.readFile()).toString('base64')}`
    } finally {
      await handleRef.close()
    }
  } catch {
    return null
  }
}

const headless = (): boolean => process.env.ANYCODE_HEADLESS === '1'

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** New file (New › File); missing parent directories are created, an existing file is an error. */
export async function createFile(path: string, content = ''): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  try {
    await writeFile(path, content, { encoding: 'utf8', flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`'${basename(path)}' already exists`, { cause: error })
    throw error
  }
}

/** New directory, with its missing parents (New › Directory, "a/b/c"). */
export async function createDirectory(path: string): Promise<void> {
  if (await exists(path)) throw new Error(`'${basename(path)}' already exists`)
  await mkdir(path, { recursive: true })
}

/** Rename refactoring of a file or directory; a case-only change is allowed on case-insensitive disks. */
export async function renamePath(from: string, to: string): Promise<void> {
  if (from === to) return
  if (from.toLowerCase() !== to.toLowerCase() && (await exists(to))) throw new Error(`'${basename(to)}' already exists`)
  await rename(from, to)
}

/** A free name in `dir` for a copy, the way Finder names them: "a.txt", "a copy.txt", "a copy 2.txt". */
export async function freeCopyName(dir: string, name: string): Promise<string> {
  if (!(await exists(join(dir, name)))) return join(dir, name)
  const dot = name.lastIndexOf('.')
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
  for (let n = 1; ; n++) {
    const candidate = join(dir, `${stem} copy${n === 1 ? '' : ` ${n}`}${ext}`)
    if (!(await exists(candidate))) return candidate
  }
}

function assertNotIntoItself(source: string, dir: string): void {
  if (isInside(source, dir)) throw new Error(`Cannot put '${basename(source)}' into itself`)
}

/** Paste after Copy: each source is copied into `dir`; returns the new paths. */
export async function copyInto(sources: readonly string[], dir: string): Promise<string[]> {
  const created: string[] = []
  for (const source of sources) {
    assertNotIntoItself(source, dir)
    const target = await freeCopyName(dir, basename(source))
    await cp(source, target, { recursive: true, errorOnExist: true, force: false })
    created.push(target)
  }
  return created
}

/** Paste after Cut (or a drag in the tree): each source moves into `dir`; returns the new paths. */
export async function moveInto(sources: readonly string[], dir: string): Promise<string[]> {
  const moved: string[] = []
  for (const source of sources) {
    const target = join(dir, basename(source))
    if (target === source) continue
    assertNotIntoItself(source, dir)
    if (await exists(target)) throw new Error(`'${basename(source)}' already exists in ${basename(dir)}`)
    try {
      await rename(source, target)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
      await cp(source, target, { recursive: true, errorOnExist: true, force: false })
      await rm(source, { recursive: true, force: true })
    }
    moved.push(target)
  }
  return moved
}

export function registerFsHandlers(): void {
  handle('fs:readDataUrl', (path) => readImageDataUrl(assertInsideProject(path)))
  handle('fs:readDir', (path) => readDirEntries(assertInsideProject(path)))
  handle('fs:readFile', (path) => readFileContent(assertInsideProject(path)))
  handle('fs:writeFile', (path, content) => writeFile(assertInsideProject(path), content, 'utf8'))
  handle('fs:listFiles', (root) => listProjectFiles(assertInsideProject(root)))
  handle('fs:exists', (path) => exists(assertInsideProject(path)))
  handle('fs:createFile', (path, content) => createFile(assertInsideProject(path), content))
  handle('fs:createDirectory', (path) => createDirectory(assertInsideProject(path)))
  handle('fs:rename', (from, to) => renamePath(assertInsideProject(from), assertInsideProject(to)))
  handle('fs:copyInto', (sources, dir) => copyInto(sources.map(assertInsideProject), assertInsideProject(dir)))
  handle('fs:moveInto', (sources, dir) => moveInto(sources.map(assertInsideProject), assertInsideProject(dir)))
  // Delete moves to the Trash, so a mistake can be undone from Finder. Headless runs (tests) delete
  // for real instead of filling the user's Trash, and never open Finder or other apps.
  handle('fs:trash', async (paths) => {
    for (const path of paths.map(assertInsideProject)) {
      if (headless()) await rm(path, { recursive: true, force: true })
      else await shell.trashItem(path)
    }
  })
  handle('shell:reveal', (path) => {
    const target = assertInsideProject(path)
    if (!headless()) shell.showItemInFolder(target)
  })
  handle('shell:openPath', async (path) => {
    const target = assertInsideProject(path)
    return headless() ? '' : shell.openPath(target)
  })
}
