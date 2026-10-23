import { open, readdir, stat, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { DirEntry, FileContent } from '@shared/ipc'
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

export function registerFsHandlers(): void {
  handle('fs:readDataUrl', (path) => readImageDataUrl(assertInsideProject(path)))
  handle('fs:readDir', (path) => readDirEntries(assertInsideProject(path)))
  handle('fs:readFile', (path) => readFileContent(assertInsideProject(path)))
  handle('fs:writeFile', (path, content) => writeFile(assertInsideProject(path), content, 'utf8'))
  handle('fs:listFiles', (root) => listProjectFiles(assertInsideProject(root)))
}
