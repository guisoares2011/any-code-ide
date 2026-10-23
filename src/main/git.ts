// Git through the `git` CLI (no shell): branch, status, file contents at HEAD, commit and push.
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { GitCommandResult, GitFileStatus, GitStatus } from '@shared/git'
import { handle } from './ipc'
import { assertInsideProject } from './project'

const run = promisify(execFile)

async function git(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await run('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 })
    return stdout
  } catch {
    return null
  }
}

/** Runs git and reports success with combined output, for user-triggered commands. */
async function gitCommand(cwd: string, args: string[]): Promise<GitCommandResult> {
  try {
    const { stdout, stderr } = await run('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 })
    return { ok: true, output: `${stdout}${stderr}`.trim() }
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; message: string }
    return { ok: false, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}`.trim() || failure.message }
  }
}

export async function currentBranch(root: string): Promise<string | null> {
  const branch = (await git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']))?.trim()
  if (branch) return branch
  return (await git(root, ['rev-parse', '--short', 'HEAD']))?.trim() || null
}

/** Status kind from the two porcelain v1 columns (index X, work tree Y). */
export function statusKind(xy: string): GitFileStatus['kind'] {
  const [x = ' ', y = ' '] = xy
  if (xy === '??') return 'untracked'
  if (x === 'U' || y === 'U' || xy === 'AA' || xy === 'DD') return 'conflicted'
  if (x === 'D' || y === 'D') return 'deleted'
  if (x === 'R' || y === 'R') return 'renamed'
  if (x === 'A' || x === 'C') return 'added'
  return 'modified'
}

/** Parses `git status --porcelain=v1 -z` output; renames carry their original path. */
export function parsePorcelain(output: string, root: string): GitFileStatus[] {
  const fields = output.split('\0')
  const files: GitFileStatus[] = []
  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i]!
    if (entry.length < 4) continue
    const xy = entry.slice(0, 2)
    const path = entry.slice(3)
    const kind = statusKind(xy)
    const file: GitFileStatus = { path: join(root, path), relativePath: path, kind, staged: xy[0] !== ' ' && xy[0] !== '?' }
    if (xy[0] === 'R' || xy[0] === 'C') file.originalPath = fields[++i]
    files.push(file)
  }
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

async function topLevel(root: string): Promise<string | null> {
  return (await git(root, ['rev-parse', '--show-toplevel']))?.trim() || null
}

export async function gitStatus(root: string): Promise<GitStatus> {
  const top = await topLevel(root)
  if (!top) return { repository: false, branch: null, files: [] }
  const output = (await git(top, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])) ?? ''
  return { repository: true, branch: await currentBranch(top), files: parsePorcelain(output, top) }
}

/** File contents at HEAD, or null when the file is not in HEAD (new) or there is no commit yet. */
export async function headContent(root: string, path: string): Promise<string | null> {
  const top = await topLevel(root)
  if (!top) return null
  const relative = path.startsWith(`${top}/`) ? path.slice(top.length + 1) : path
  return git(top, ['show', `HEAD:${relative}`])
}

/**
 * Commits exactly the selected files (IntelliJ's partial commit): new files are added first, then
 * `git commit --only` records the work tree state of just those paths.
 */
export async function commit(root: string, message: string, paths: readonly string[]): Promise<GitCommandResult> {
  if (!message.trim()) return { ok: false, output: 'The commit message is empty.' }
  if (paths.length === 0) return { ok: false, output: 'No files selected.' }
  const top = await topLevel(root)
  if (!top) return { ok: false, output: 'Not a git repository.' }
  const status = await gitStatus(top)
  const selected = new Set(paths)
  const untracked = status.files.filter((f) => f.kind === 'untracked' && selected.has(f.path)).map((f) => f.relativePath)
  if (untracked.length > 0) {
    const added = await gitCommand(top, ['add', '--', ...untracked])
    if (!added.ok) return added
  }
  const relative = status.files
    .filter((f) => selected.has(f.path))
    .flatMap((f) => (f.originalPath ? [f.relativePath, f.originalPath] : [f.relativePath]))
  return gitCommand(top, ['commit', '--only', '-m', message, '--', ...relative])
}

/** Pushes the current branch, setting its upstream on the first push. */
export async function push(root: string): Promise<GitCommandResult> {
  const upstream = await git(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
  return upstream ? gitCommand(root, ['push']) : gitCommand(root, ['push', '--set-upstream', 'origin', 'HEAD'])
}

export function registerGitHandlers(): void {
  handle('git:branch', (root) => currentBranch(assertInsideProject(root)))
  handle('git:status', (root) => gitStatus(assertInsideProject(root)))
  handle('git:headContent', (root, path) => headContent(assertInsideProject(root), assertInsideProject(path)))
  handle('git:commit', (root, message, paths) => commit(assertInsideProject(root), message, paths.map(assertInsideProject)))
  handle('git:push', (root) => push(assertInsideProject(root)))
}
