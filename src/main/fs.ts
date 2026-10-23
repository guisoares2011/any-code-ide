import { open, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DirEntry, FileContent } from '@shared/ipc'
import { listProjectFiles } from './fileIndex'
import { handle } from './ipc'
import { assertInsideProject } from './project'

const MAX_TEXT_BYTES = 5 * 1024 * 1024
const BINARY_SNIFF_BYTES = 8000

export async function readDirEntries(dir: string): Promise<DirEntry[]> {
  const entries = await readdir(dir, { withFileTypes: true })
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

export function registerFsHandlers(): void {
  handle('fs:readDir', (path) => readDirEntries(assertInsideProject(path)))
  handle('fs:readFile', (path) => readFileContent(assertInsideProject(path)))
  handle('fs:writeFile', (path, content) => writeFile(assertInsideProject(path), content, 'utf8'))
  handle('fs:listFiles', (root) => listProjectFiles(assertInsideProject(root)))
}
