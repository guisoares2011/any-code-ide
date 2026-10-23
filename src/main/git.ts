// Git through the `git` CLI (no shell): branch, status, file contents at a revision, commit, push,
// rollback and the log.
import { execFile } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { GitBranchList, GitChangedFile, GitCommandResult, GitCommit, GitCommitDetails, GitFileStatus, GitLogQuery, GitStatus } from '@shared/git'
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

/** File contents at a revision, or null when the file (or the revision) does not exist. */
export async function fileAtRevision(root: string, revision: string, path: string): Promise<string | null> {
  const top = await topLevel(root)
  if (!top || revision.startsWith('-')) return null
  const relative = path.startsWith(`${top}/`) ? path.slice(top.length + 1) : path
  return git(top, ['show', `${revision}:${relative}`])
}

/** File contents at HEAD, or null when the file is not in HEAD (new) or there is no commit yet. */
export const headContent = (root: string, path: string): Promise<string | null> => fileAtRevision(root, 'HEAD', path)

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

/**
 * Rollback (ChangesView.Revert): tracked changes of `paths` go back to HEAD in the index and the
 * work tree. Files added since HEAD leave the index and, with deleteAdded, the disk; a rename is
 * undone by restoring the source and removing the new path. Unversioned files are left alone.
 */
export async function rollback(root: string, paths: readonly string[], deleteAdded: boolean): Promise<GitCommandResult> {
  const top = await topLevel(root)
  if (!top) return { ok: false, output: 'Not a git repository.' }
  const selected = new Set(paths)
  const files = (await gitStatus(top)).files.filter((f) => selected.has(f.path) && f.kind !== 'untracked')
  if (files.length === 0) return { ok: false, output: 'No changes to roll back.' }
  const hasHead = (await git(top, ['rev-parse', '--verify', '--quiet', 'HEAD'])) !== null
  const toRestore: string[] = []
  const toUnstage: string[] = []
  const toDelete: string[] = []
  for (const file of files) {
    if (file.kind === 'added' || !hasHead) {
      toUnstage.push(file.relativePath)
      if (deleteAdded) toDelete.push(file.path)
    } else if (file.kind === 'renamed' && file.originalPath) {
      toRestore.push(file.originalPath)
      toUnstage.push(file.relativePath)
      toDelete.push(file.path)
    } else toRestore.push(file.relativePath)
  }
  const outputs: string[] = []
  if (toUnstage.length > 0) {
    const result = await gitCommand(top, ['rm', '--cached', '--force', '--quiet', '--ignore-unmatch', '--', ...toUnstage])
    if (!result.ok) return result
    outputs.push(result.output)
  }
  if (toRestore.length > 0) {
    const result = await gitCommand(top, ['restore', '--source=HEAD', '--staged', '--worktree', '--', ...toRestore])
    if (!result.ok) return result
    outputs.push(result.output)
  }
  await Promise.all(toDelete.map((path) => rm(path, { force: true })))
  return { ok: true, output: outputs.filter(Boolean).join('\n') }
}

const FIELD = '\x1f'
const RECORD = '\x1e'
const LOG_FORMAT = ['%H', '%P', '%an', '%ae', '%at', '%D', '%s'].join('%x1f') + '%x1e'
const DEFAULT_LOG_LIMIT = 300

/** Parses `git log` output in LOG_FORMAT. */
export function parseLog(output: string): GitCommit[] {
  return output
    .split(RECORD)
    .map((record) => record.replace(/^\n/, ''))
    .filter((record) => record.length > 0)
    .map((record) => {
      const [hash = '', parents = '', author = '', email = '', date = '0', refs = '', subject = ''] = record.split(FIELD)
      return {
        hash,
        parents: parents ? parents.split(' ') : [],
        author,
        email,
        date: Number(date) * 1000,
        refs: refs ? refs.split(', ') : [],
        subject,
      }
    })
}

/** The log, newest first (date order like IntelliJ's), filtered like the Log tab's filters. */
export async function log(root: string, query: GitLogQuery): Promise<GitCommit[]> {
  const top = await topLevel(root)
  if (!top) return []
  const limit = Math.min(Math.max(query.limit ?? DEFAULT_LOG_LIMIT, 1), 5000)
  const args = ['log', '--date-order', `--format=${LOG_FORMAT}`, `--max-count=${limit}`, `--skip=${Math.max(query.skip ?? 0, 0)}`]
  if (query.author) args.push(`--author=${query.author}`, '--regexp-ignore-case')
  const text = query.text?.trim()
  if (text) args.push(`--grep=${text}`, '--fixed-strings', '--regexp-ignore-case')
  if (query.branch && !query.branch.startsWith('-')) args.push(query.branch)
  else if (!query.path) args.push('--all')
  if (query.path) {
    const relative = query.path.startsWith(`${top}/`) ? query.path.slice(top.length + 1) : query.path
    args.push('--follow', '--', relative)
  }
  const commits = parseLog((await git(top, args)) ?? '')
  // A hash typed in the text filter finds that commit even when its message does not match.
  if (text && /^[0-9a-f]{4,40}$/i.test(text) && !query.skip && !commits.some((c) => c.hash.startsWith(text.toLowerCase()))) {
    const byHash = parseLog((await git(top, ['log', '-1', `--format=${LOG_FORMAT}`, `${text}^{commit}`, '--'])) ?? '')
    return [...byHash, ...commits]
  }
  return commits
}

/** Parses `git diff-tree -r -M --name-status -z` output. */
export function parseNameStatus(output: string, top: string): GitChangedFile[] {
  const fields = output.split('\0')
  const files: GitChangedFile[] = []
  for (let i = 0; i < fields.length; i++) {
    const status = fields[i]!
    if (!/^[AMDRCT]/.test(status)) continue
    const code = status[0]!
    if (code === 'R' || code === 'C') {
      const originalPath = fields[++i]!
      const relativePath = fields[++i]!
      files.push({ path: join(top, relativePath), relativePath, kind: code === 'R' ? 'renamed' : 'added', originalPath })
    } else {
      const relativePath = fields[++i]!
      const kind = code === 'A' ? 'added' : code === 'D' ? 'deleted' : 'modified'
      files.push({ path: join(top, relativePath), relativePath, kind })
    }
  }
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

export async function commitDetails(root: string, hash: string): Promise<GitCommitDetails | null> {
  const top = await topLevel(root)
  if (!top || !/^[0-9a-f]{4,64}$/i.test(hash)) return null
  const message = await git(top, ['log', '-1', '--format=%B', hash, '--'])
  if (message === null) return null
  const changes = (await git(top, ['diff-tree', '--no-commit-id', '-r', '-M', '--name-status', '-z', '--root', '-m', '--first-parent', hash])) ?? ''
  return { hash, message: message.trimEnd(), files: parseNameStatus(changes, top) }
}

export async function branches(root: string): Promise<string[]> {
  const output = await git(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes'])
  return (output ?? '').split('\n').filter((name) => name && !name.endsWith('/HEAD'))
}

/** `%(upstream:track)` → ahead/behind counts, e.g. "[ahead 2, behind 1]". */
export function parseTrack(track: string): { ahead: number; behind: number } {
  return { ahead: Number(/ahead (\d+)/.exec(track)?.[1] ?? 0), behind: Number(/behind (\d+)/.exec(track)?.[1] ?? 0) }
}

export async function branchList(root: string): Promise<GitBranchList> {
  const format = '%(refname)%00%(refname:short)%00%(upstream:short)%00%(upstream:track)'
  const output = (await git(root, ['for-each-ref', `--format=${format}`, 'refs/heads', 'refs/remotes'])) ?? ''
  const result: GitBranchList = { current: await currentBranch(root), local: [], remote: [] }
  for (const line of output.split('\n')) {
    const [ref, name, upstream, track] = line.split('\0')
    if (!ref || !name) continue
    if (ref.startsWith('refs/heads/')) result.local.push({ name, ...(upstream ? { upstream } : {}), ...parseTrack(track ?? '') })
    else if (!ref.endsWith('/HEAD')) result.remote.push(name)
  }
  return result
}

/** Git.Branches: checkout of a local branch, a remote branch (new local tracking branch) or a new branch. */
export async function checkout(root: string, branch: string, mode: 'local' | 'remote' | 'create'): Promise<GitCommandResult> {
  if (mode === 'create') return gitCommand(root, ['checkout', '-b', branch])
  if (mode === 'local') return gitCommand(root, ['checkout', branch])
  // origin/feature → feature; an existing local branch of that name is checked out instead.
  const local = branch.slice(branch.indexOf('/') + 1)
  const exists = (await git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${local}`])) !== null
  return gitCommand(root, exists ? ['checkout', local] : ['checkout', '--track', '-b', local, branch])
}

export function registerGitHandlers(): void {
  handle('git:branch', (root) => currentBranch(assertInsideProject(root)))
  handle('git:status', (root) => gitStatus(assertInsideProject(root)))
  handle('git:headContent', (root, path) => headContent(assertInsideProject(root), assertInsideProject(path)))
  handle('git:commit', (root, message, paths) => commit(assertInsideProject(root), message, paths.map(assertInsideProject)))
  handle('git:push', (root) => push(assertInsideProject(root)))
  handle('git:rollback', (root, paths, deleteAdded) => rollback(assertInsideProject(root), paths.map(assertInsideProject), deleteAdded))
  handle('git:log', (root, query) => log(assertInsideProject(root), { ...query, path: query.path && assertInsideProject(query.path) }))
  handle('git:commitDetails', (root, hash) => commitDetails(assertInsideProject(root), hash))
  handle('git:show', (root, revision, path) => fileAtRevision(assertInsideProject(root), revision, assertInsideProject(path)))
  handle('git:branches', (root) => branches(assertInsideProject(root)))
  handle('git:branchList', (root) => branchList(assertInsideProject(root)))
  handle('git:checkout', (root, branch, mode) => checkout(assertInsideProject(root), branch, mode))
}
