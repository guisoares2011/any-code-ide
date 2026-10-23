import { execFile } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** Directories never worth indexing, used when the project is not a git repository. */
const IGNORED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  '.idea',
  '.gradle',
  'build',
  'out',
  'dist',
  'target',
  '.next',
  '.turbo',
  '.cache',
  'coverage',
  '__pycache__',
  '.venv',
])

export const MAX_INDEXED_FILES = 50_000

/** Project files relative to `root`: tracked and untracked-but-not-ignored when it is a git work tree. */
export async function listProjectFiles(root: string): Promise<string[]> {
  try {
    const { stdout } = await run('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
      cwd: root,
      maxBuffer: 64 * 1024 * 1024,
    })
    const files = [...new Set(stdout.split('\0').filter(Boolean))]
    return files.slice(0, MAX_INDEXED_FILES)
  } catch {
    return walk(root)
  }
}

async function walk(root: string): Promise<string[]> {
  const files: string[] = []
  const queue = [root]
  while (queue.length > 0 && files.length < MAX_INDEXED_FILES) {
    const dir = queue.shift()!
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) queue.push(path)
      } else if (entry.isFile()) {
        files.push(relative(root, path))
      }
    }
  }
  return files
}
