export type GitFileKind = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted'

export interface GitFileStatus {
  /** Absolute path. */
  path: string
  /** Path relative to the repository root, as git prints it. */
  relativePath: string
  kind: GitFileKind
  /** Has changes in the index. */
  staged: boolean
  /** Source path of a rename or copy, relative to the repository root. */
  originalPath?: string
}

export interface GitStatus {
  repository: boolean
  branch: string | null
  files: GitFileStatus[]
}

/** Branches for the VCS widget's popup (Git.Branches). */
export interface GitBranchList {
  current: string | null
  local: { name: string; upstream?: string; ahead: number; behind: number }[]
  /** Remote-tracking branches, e.g. "origin/main" (without origin/HEAD). */
  remote: string[]
}

export interface GitCommandResult {
  ok: boolean
  output: string
}

/** A commit of the log (Version Control tool window). */
export interface GitCommit {
  hash: string
  parents: string[]
  author: string
  email: string
  /** Author date, ms since the epoch. */
  date: number
  /** Decorations as git prints them: "HEAD -> main", "origin/main", "tag: v1". */
  refs: string[]
  subject: string
}

export interface GitLogQuery {
  /** Matches the message (case-insensitive, literal) or a hash prefix. */
  text?: string
  /** A branch or other revision; every ref when absent. */
  branch?: string
  author?: string
  /** History of one file (absolute path), following renames. */
  path?: string
  skip?: number
  limit?: number
}

export interface GitChangedFile {
  /** Absolute path in the commit. */
  path: string
  relativePath: string
  kind: Exclude<GitFileKind, 'untracked' | 'conflicted'>
  /** Path before a rename, relative to the repository root. */
  originalPath?: string
}

export interface GitCommitDetails {
  hash: string
  /** Full message. */
  message: string
  /** Changes against the first parent (the whole tree for a root commit). */
  files: GitChangedFile[]
}
