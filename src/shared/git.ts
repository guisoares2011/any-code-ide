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

export interface GitCommandResult {
  ok: boolean
  output: string
}
