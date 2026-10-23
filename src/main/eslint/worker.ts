// Runs a project's own ESLint in a separate Node process (Electron with ELECTRON_RUN_AS_NODE), so
// its configuration and plugins (project code) never load into the main process. One worker per
// project root, which is argv[2]; requests and replies travel over the fork IPC channel.
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { FixResult, LintProblem, LintResult } from '@shared/eslint'

export interface WorkerRequest {
  id: number
  filePath: string
  text: string
  fix: boolean
}

export interface WorkerReply {
  id: number
  result: LintResult | FixResult
}

interface EslintMessage {
  line?: number
  column?: number
  endLine?: number
  endColumn?: number
  severity: number
  message: string
  ruleId: string | null
}

interface EslintInstance {
  lintText(text: string, options: { filePath: string; warnIgnored: boolean }): Promise<{ messages: EslintMessage[]; output?: string }[]>
}

type EslintClass = new (options: { cwd: string; fix: boolean }) => EslintInstance

interface EslintModule {
  ESLint?: EslintClass
  /** ESLint 8.57+: the class matching the project's configuration style (flat or eslintrc). */
  loadESLint?: (options: { cwd: string }) => Promise<EslintClass>
}

const root = process.argv[2] ?? process.cwd()
// Kept out of the bundler's reach: ESLint may be an ES module, which only a real import() loads.
const importModule = new Function('url', 'return import(url)') as (url: string) => Promise<EslintModule & { default?: EslintModule }>

let engines: Promise<{ lint: EslintInstance; fix: EslintInstance } | string> | null = null

async function loadEngines(): Promise<{ lint: EslintInstance; fix: EslintInstance } | string> {
  let entry: string
  try {
    entry = createRequire(join(root, 'package.json')).resolve('eslint')
  } catch {
    return 'ESLint is not installed in this project'
  }
  const loaded = await importModule(pathToFileURL(entry).href)
  const api = loaded.loadESLint || loaded.ESLint ? loaded : (loaded.default ?? loaded)
  const ESLint = api.loadESLint ? await api.loadESLint({ cwd: root }) : api.ESLint
  if (!ESLint) return 'Unsupported ESLint version'
  return { lint: new ESLint({ cwd: root, fix: false }), fix: new ESLint({ cwd: root, fix: true }) }
}

/** ESLint without a configuration file: nothing to lint, like IntelliJ's automatic mode. */
const NO_CONFIG = /Could not find config file|No ESLint configuration found/i

const toProblem = (m: EslintMessage): LintProblem => ({
  line: m.line ?? 1,
  column: m.column ?? 1,
  endLine: m.endLine ?? m.line ?? 1,
  endColumn: m.endColumn ?? (m.column ?? 1) + 1,
  severity: m.severity === 2 ? 'error' : 'warning',
  message: m.message,
  ruleId: m.ruleId,
})

async function handle(request: WorkerRequest): Promise<LintResult | FixResult> {
  engines ??= loadEngines()
  let loaded
  try {
    loaded = await engines
  } catch (error) {
    engines = null // a broken installation; try again on the next request
    return { status: 'error', message: error instanceof Error ? error.message : String(error) }
  }
  if (typeof loaded === 'string') return { status: 'unavailable', reason: loaded }
  try {
    const [result] = await (request.fix ? loaded.fix : loaded.lint).lintText(request.text, { filePath: request.filePath, warnIgnored: false })
    if (request.fix) return { status: 'ok', output: result?.output ?? null }
    return { status: 'ok', problems: (result?.messages ?? []).map(toProblem) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NO_CONFIG.test(message) ? { status: 'unavailable', reason: 'No ESLint configuration' } : { status: 'error', message }
  }
}

process.on('message', (request: WorkerRequest) => {
  void handle(request).then((result) => process.send?.({ id: request.id, result } satisfies WorkerReply))
})
// The main process went away (quit or crash): nothing left to serve.
process.on('disconnect', () => process.exit(0))
