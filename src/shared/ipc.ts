import type { AtMention, BridgeStatus, EditorSelection, McpToolResult } from './bridge'
import type { FixResult, LintResult } from './eslint'
import type { GitCommandResult, GitCommit, GitCommitDetails, GitLogQuery, GitStatus } from './git'
import type { LanguageServerId } from './languageServers'
import type { MavenDependenciesResult, MavenModule } from './maven'
import type { Settings } from './settings'
import type { RunCommand, RunConfigurationSpec } from './runConfigurations'

// IPC contract shared by main, preload and renderer. Every channel is declared here once;
// the preload only forwards channels listed in these constants.

export interface AppInfo {
  platform: NodeJS.Platform
  headless: boolean
  version: string
  /**
   * Command line of the agent terminal tab, e.g. ["claude"]; null means a plain login shell
   * (default in headless runs so tests never start a real Claude session).
   */
  agentCommand: string[] | null
}

export interface ProjectInfo {
  root: string
  name: string
}

export interface RecentProject {
  path: string
  name: string
  /** "AnyCode", or the JetBrains IDE that remembers it ("IntelliJ IDEA", "WebStorm"...). */
  source: string
  /** Epoch milliseconds of the last activation. */
  lastOpened: number
}

export type DirEntryKind = 'file' | 'directory' | 'symlink'

export interface DirEntry {
  name: string
  path: string
  kind: DirEntryKind
}

export type FileContent =
  | { kind: 'text'; content: string }
  | { kind: 'binary'; size: number }
  | { kind: 'too-large'; size: number }

export interface PtyCreateOptions {
  cwd: string
  cols: number
  rows: number
  /** Command line to run instead of the user's login shell, e.g. ["claude"]. */
  command?: string[]
  /** Shell script to run instead (`$SHELL -l -c <script>`); used by run configurations. */
  script?: string
  /** Extra environment variables. */
  env?: Record<string, string>
}

export interface PtyExit {
  id: string
  exitCode: number
  signal: number | null
}

/** Request/response channels: renderer -> main via ipcRenderer.invoke. */
export interface InvokeChannels {
  'app:info': { args: []; result: AppInfo }
  /** Projects to show at startup and which one is current. */
  'project:initial': { args: []; result: { projects: ProjectInfo[]; current: string | null } }
  /** Opens a directory as a project (adds it to the allowed roots); null when it is not a directory. */
  'project:open': { args: [path: string]; result: ProjectInfo | null }
  'project:close': { args: [root: string]; result: void }
  'project:recent': { args: []; result: RecentProject[] }
  /** Native folder picker; null when cancelled or in headless mode. */
  'project:pickFolder': { args: []; result: string | null }
  'fs:readDir': { args: [path: string]; result: DirEntry[] }
  'fs:readFile': { args: [path: string]; result: FileContent }
  'fs:writeFile': { args: [path: string, content: string]; result: void }
  /** An image inside a project as a data: URL (Markdown preview); null when missing or not an image. */
  'fs:readDataUrl': { args: [path: string]; result: string | null }
  /** Files of a project root, relative to it (git ls-files when available). */
  'fs:listFiles': { args: [root: string]; result: string[] }
  /** Current branch name, a short commit hash when detached, or null outside a git work tree. */
  'git:branch': { args: [root: string]; result: string | null }
  'git:status': { args: [root: string]; result: GitStatus }
  /** File contents at HEAD; null for files not in HEAD. */
  'git:headContent': { args: [root: string, path: string]; result: string | null }
  /** Commits exactly `paths` (absolute), adding untracked ones first. */
  'git:commit': { args: [root: string, message: string, paths: string[]]; result: GitCommandResult }
  'git:push': { args: [root: string]; result: GitCommandResult }
  /** Reverts tracked changes of `paths` to HEAD (Rollback); added files leave the index and, with deleteAdded, the disk. */
  'git:rollback': { args: [root: string, paths: string[], deleteAdded: boolean]; result: GitCommandResult }
  'git:log': { args: [root: string, query: GitLogQuery]; result: GitCommit[] }
  'git:commitDetails': { args: [root: string, hash: string]; result: GitCommitDetails | null }
  /** File contents at a revision (`<hash>`, `<hash>^`, HEAD); null when the file is not there. */
  'git:show': { args: [root: string, revision: string, path: string]; result: string | null }
  /** Local and remote branch names. */
  'git:branches': { args: [root: string]; result: string[] }
  /** Lints a document's text with the project's ESLint. */
  'eslint:lint': { args: [root: string, path: string, text: string]; result: LintResult }
  /** The text with ESLint's fixes applied (Fix ESLint Problems). */
  'eslint:fix': { args: [root: string, path: string, text: string]; result: FixResult }
  /** Restarts a project's ESLint (its configuration or installation changed). */
  'eslint:reset': { args: [root: string]; result: void }
  'pty:create': { args: [options: PtyCreateOptions]; result: string }
  'pty:write': { args: [id: string, data: string]; result: void }
  'pty:resize': { args: [id: string, cols: number, rows: number]; result: void }
  'pty:kill': { args: [id: string]; result: void }
  /** Interrupts the foreground job (^C), then kills the process group if it outlives the grace period. */
  'pty:stop': { args: [id: string]; result: void }
  /** Every run configuration of a project: project files, AnyCode's, IntelliJ's and detected ones. */
  'run:configurations': { args: [root: string]; result: RunConfigurationSpec[] }
  /** Saves privately or as .run/<name>.run.xml; returns the configuration with its new id/origin. */
  'run:save': { args: [root: string, spec: RunConfigurationSpec, asProjectFile: boolean]; result: RunConfigurationSpec }
  'run:delete': { args: [root: string, id: string]; result: void }
  /** The shell script, directory and environment that run a configuration. */
  'run:command': { args: [root: string, spec: RunConfigurationSpec]; result: RunCommand }
  'maven:modules': { args: [root: string]; result: MavenModule[] }
  /** Runs `dependency:tree` for the whole reactor (slow: starts Maven). */
  'maven:dependencies': { args: [root: string]; result: MavenDependenciesResult }
  /** Answer to a bridge:toolCall event. */
  'bridge:toolResult': { args: [requestId: string, result: McpToolResult]; result: void }
  'bridge:status': { args: []; result: BridgeStatus }
  /** Starts (or reuses) a language server for a project root; null when it cannot run. */
  'lsp:start': { args: [server: LanguageServerId, root: string]; result: string | null }
  /** Install location of each language server, or null when it is not installed. */
  'lsp:locations': { args: []; result: Record<LanguageServerId, string | null> }
  'settings:get': { args: []; result: Settings }
  /** Saves the settings; returns them as stored (normalized). */
  'settings:set': { args: [settings: Settings]; result: Settings }
}

/** Fire-and-forget channels: renderer -> main via ipcRenderer.send. */
export interface SendChannels {
  'app:rendererReady': []
  /** The project shown in the window changed (remembered for the next start). */
  'project:activated': [root: string]
  /** Forwarded to Claude Code as the selection_changed notification. */
  'bridge:selectionChanged': [selection: EditorSelection]
  /** Forwarded to Claude Code as the at_mentioned notification. */
  'bridge:atMentioned': [mention: AtMention]
  /** A JSON-RPC message for a language server session. */
  'lsp:send': [sessionId: string, message: unknown]
}

/** Events: main -> renderer via webContents.send. */
export interface EventChannels {
  'pty:data': [id: string, data: string]
  'pty:exit': [exit: PtyExit]
  /** A Claude Code tool call the renderer must answer with bridge:toolResult. */
  'bridge:toolCall': [requestId: string, name: string, args: Record<string, unknown>]
  'bridge:status': [status: BridgeStatus]
  /** Files or directories changed on disk under an opened project (absolute paths). */
  'fs:changed': [paths: string[]]
  'lsp:message': [sessionId: string, message: unknown]
  'lsp:exit': [sessionId: string, code: number | null]
}

export const INVOKE_CHANNELS = [
  'app:info',
  'project:initial',
  'project:open',
  'project:close',
  'project:recent',
  'project:pickFolder',
  'fs:readDir',
  'fs:readFile',
  'fs:writeFile',
  'fs:listFiles',
  'fs:readDataUrl',
  'git:branch',
  'git:status',
  'git:headContent',
  'git:commit',
  'git:push',
  'git:rollback',
  'git:log',
  'git:commitDetails',
  'git:show',
  'git:branches',
  'eslint:lint',
  'eslint:fix',
  'eslint:reset',
  'pty:create',
  'pty:write',
  'pty:resize',
  'pty:kill',
  'pty:stop',
  'run:configurations',
  'run:save',
  'run:delete',
  'run:command',
  'maven:modules',
  'maven:dependencies',
  'bridge:toolResult',
  'bridge:status',
  'lsp:start',
  'lsp:locations',
  'settings:get',
  'settings:set',
] as const satisfies readonly (keyof InvokeChannels)[]

export const SEND_CHANNELS = ['app:rendererReady', 'project:activated', 'bridge:selectionChanged', 'bridge:atMentioned', 'lsp:send'] as const satisfies readonly (keyof SendChannels)[]

export const EVENT_CHANNELS = ['pty:data', 'pty:exit', 'bridge:toolCall', 'bridge:status', 'fs:changed', 'lsp:message', 'lsp:exit'] as const satisfies readonly (keyof EventChannels)[]

export type InvokeChannel = keyof InvokeChannels
export type InvokeArgs<C extends InvokeChannel> = InvokeChannels[C]['args']
export type InvokeResult<C extends InvokeChannel> = InvokeChannels[C]['result']

/** The object the preload exposes as `window.anycode`. */
export interface AnyCodeBridge {
  invoke<C extends InvokeChannel>(channel: C, ...args: InvokeArgs<C>): Promise<InvokeResult<C>>
  send<C extends keyof SendChannels>(channel: C, ...args: SendChannels[C]): void
  /** Subscribes to a main-process event; returns the unsubscribe function. */
  on<C extends keyof EventChannels>(channel: C, listener: (...args: EventChannels[C]) => void): () => void
}
