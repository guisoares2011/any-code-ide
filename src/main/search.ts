// Find in Files over the files on disk: the project's files (git ls-files, as Go to File), filtered by
// directory and file mask, read in parallel and matched with the shared matcher.
import { readFile, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import type { WebContents } from 'electron'
import { buildPattern, fileMaskFilter, findMatches, type FileMatches, type SearchRequest, type SearchResult } from '@shared/textSearch'
import { listProjectFiles } from './fileIndex'
import { handleFrom, onSendFrom } from './ipc'
import { assertInsideProject } from './project'

/** IntelliJ's popup stops at about this many usages too; beyond that the user refines the query. */
export const MAX_MATCHES = 2000
const MAX_FILE_SIZE = 5 * 1024 * 1024
const CONCURRENCY = 24

/** A NUL byte in the first 8 KB marks a binary file, as git does. */
function isBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, 8192).includes(0)
}

export async function searchFiles(request: SearchRequest, cancelled: () => boolean = () => false): Promise<SearchResult> {
  const pattern = buildPattern(request.options)
  if (!(pattern instanceof RegExp)) return { files: [], total: 0, truncated: false, error: pattern.error }
  const inMask = fileMaskFilter(request.options.fileMask)
  const below = request.directory ? relative(request.root, request.directory).split(sep).join('/') : ''
  const files = (await listProjectFiles(request.root)).filter(
    (file) => (below === '' || file.startsWith(`${below}/`)) && inMask(file),
  )

  const found = new Map<number, FileMatches>()
  let total = 0
  let truncated = false
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < files.length && !truncated && !cancelled()) {
      const index = next++
      const path = join(request.root, files[index]!)
      try {
        if ((await stat(path)).size > MAX_FILE_SIZE) continue
        const buffer = await readFile(path)
        if (isBinary(buffer)) continue
        const matches = findMatches(buffer.toString('utf8'), pattern, MAX_MATCHES - total)
        if (matches.length === 0) continue
        found.set(index, { path, matches })
        total += matches.length
        if (total >= MAX_MATCHES) truncated = true
      } catch {
        // Deleted or unreadable since it was listed.
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  // In listing order, so results do not jump around between runs.
  const ordered = [...found.entries()].sort((a, b) => a[0] - b[0]).map(([, file]) => file)
  return { files: ordered, total, truncated }
}

export function registerSearchHandlers(): void {
  // The latest search of each window: a newer one (the user kept typing) cancels the running one.
  const latest = new Map<number, number>()
  const isStale = (sender: WebContents, id: number) => () => latest.get(sender.id) !== id
  handleFrom('search:find', async (sender, request) => {
    latest.set(sender.id, request.id)
    const root = assertInsideProject(request.root)
    const directory = request.directory ? assertInsideProject(request.directory) : undefined
    return searchFiles({ ...request, root, directory }, isStale(sender, request.id))
  })
  onSendFrom('search:cancel', (sender) => latest.delete(sender.id))
}
