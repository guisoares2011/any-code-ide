// ESLint in the editor, like IntelliJ's automatic ESLint configuration: JS/TS documents are linted
// by the project's own ESLint when they open and as they change. Problems become Monaco markers
// (owner "eslint"), so they show in the editor, in Problems and in the bridge's getDiagnostics.
import * as monaco from 'monaco-editor'
import type { LintProblem } from '@shared/eslint'
import { basename } from '@shared/paths'
import { actions } from '../keymap/service'
import { notify } from '../state/notifications'
import { projectRootOf } from '../state/projects'
import { workbench } from '../state/workbench'

const OWNER = 'eslint'
const LANGUAGES = new Set(['javascript', 'typescript'])
const LINT_DELAY_MS = 500
/** Files whose change can change ESLint's setup: its configuration and the installation. */
const SETUP_FILE = /^(eslint\.config\.[cm]?[jt]s|\.eslintrc(\.\w+)?|package\.json|package-lock\.json)$/

/** Roots where ESLint is not installed or not configured; retried when the setup changes. */
const unavailable = new Set<string>()
/** Errors already reported, so a broken configuration notifies once. */
const reported = new Set<string>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()
let enabled = true
let installed = false

const lintable = (model: monaco.editor.ITextModel): boolean => model.uri.scheme === 'file' && LANGUAGES.has(model.getLanguageId())

function toMarker(problem: LintProblem): monaco.editor.IMarkerData {
  return {
    severity: problem.severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
    message: `ESLint: ${problem.message}${problem.ruleId ? ` (${problem.ruleId})` : ''}`,
    source: 'eslint',
    ...(problem.ruleId ? { code: problem.ruleId } : {}),
    startLineNumber: problem.line,
    startColumn: problem.column,
    endLineNumber: problem.endLine,
    endColumn: problem.endColumn,
  }
}

async function lint(model: monaco.editor.ITextModel): Promise<void> {
  const path = model.uri.fsPath
  const root = projectRootOf(path)
  if (!enabled || !root || unavailable.has(root) || model.isDisposed()) return
  const version = model.getVersionId()
  const result = await window.anycode.invoke('eslint:lint', root, path, model.getValue())
  if (model.isDisposed() || model.getVersionId() !== version) return // a newer lint follows
  if (result.status === 'unavailable') {
    unavailable.add(root)
    monaco.editor.setModelMarkers(model, OWNER, [])
  } else if (result.status === 'error') {
    if (!reported.has(`${root}\0${result.message}`)) {
      reported.add(`${root}\0${result.message}`)
      notify('error', 'ESLint failed', result.message)
    }
  } else monaco.editor.setModelMarkers(model, OWNER, result.problems.map(toMarker))
}

function schedule(model: monaco.editor.ITextModel, delay = LINT_DELAY_MS): void {
  const key = model.uri.toString()
  clearTimeout(timers.get(key))
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key)
      void lint(model)
    }, delay),
  )
}

function lintAll(): void {
  for (const model of monaco.editor.getModels()) if (lintable(model)) schedule(model, 0)
}

/** Turns ESLint on or off (Settings); off clears its problems. */
export function setEslintEnabled(on: boolean): void {
  if (enabled === on) return
  enabled = on
  if (on) lintAll()
  else for (const model of monaco.editor.getModels()) monaco.editor.setModelMarkers(model, OWNER, [])
}

/** Fix ESLint Problems: applies ESLint's fixes to the active document as one undoable edit. */
async function fixActiveDocument(): Promise<void> {
  const model = activeModel()
  const root = model && projectRootOf(model.uri.fsPath)
  if (!model || !root) return
  const result = await window.anycode.invoke('eslint:fix', root, model.uri.fsPath, model.getValue())
  if (result.status === 'unavailable') notify('info', 'ESLint is not configured', `${result.reason} for ${basename(root)}.`)
  else if (result.status === 'error') notify('error', 'ESLint failed', result.message)
  else if (result.output !== null && result.output !== model.getValue()) {
    model.pushStackElement()
    model.pushEditOperations([], [{ range: model.getFullModelRange(), text: result.output }], () => null)
    model.pushStackElement()
  }
}

function activeModel(): monaco.editor.ITextModel | null {
  const { tabs, activeTab } = workbench.get()
  const tab = tabs.find((t) => t.path === activeTab)
  if (tab?.kind !== 'file') return null
  const model = monaco.editor.getModel(monaco.Uri.file(tab.path))
  return model && lintable(model) ? model : null
}

export function installEslint(): void {
  if (installed) return
  installed = true
  const watch = (model: monaco.editor.ITextModel): void => {
    if (!lintable(model)) return
    schedule(model, 0)
    model.onDidChangeContent(() => schedule(model))
    model.onWillDispose(() => clearTimeout(timers.get(model.uri.toString())))
  }
  monaco.editor.onDidCreateModel(watch)
  monaco.editor.getModels().forEach(watch)
  // A new configuration or installation: restart that project's ESLint and lint again.
  window.anycode.on('fs:changed', (paths) => {
    const roots = new Set(paths.filter((p) => SETUP_FILE.test(basename(p))).flatMap((p) => projectRootOf(p) ?? []))
    for (const root of roots) {
      unavailable.delete(root)
      void window.anycode.invoke('eslint:reset', root).then(lintAll)
    }
  })
  actions.register({
    id: 'AnyCode.ESLintFix',
    text: 'Fix ESLint Problems',
    isEnabled: () => enabled && activeModel() !== null,
    perform: () => void fixActiveDocument(),
  })
}
