// Running JUnit tests from the editor: a "Run" CodeLens above test classes and methods (IntelliJ's
// run gutter icons) and RunClass (⌃⇧R) for the test at the caret. Each run is a temporary
// configuration, like IntelliJ's.
import * as monaco from 'monaco-editor'
import { junitName, type JUnitConfiguration, type JUnitScope } from '@shared/runConfigurations'
import { actions } from '../keymap/service'
import { workbench } from '../state/workbench'
import { debugConfiguration } from '../debug/launch'
import { runTemporary } from './runState'
import { findTests, moduleOfTestFile, type TestFile } from './testDetection'

const RUN_TEST_COMMAND = 'anycode.junit.run'
const DEBUG_TEST_COMMAND = 'anycode.junit.debug'
let installed = false

export interface TestTarget {
  scope: Extract<JUnitScope, 'class' | 'method'>
  className: string
  methodName: string
}

export function testConfiguration(path: string, target: TestTarget): JUnitConfiguration | null {
  const root = workbench.get().project?.root
  if (!root) return null
  const dot = target.className.lastIndexOf('.')
  const fields = {
    scope: target.scope,
    module: moduleOfTestFile(root, path),
    packageName: dot > 0 ? target.className.slice(0, dot) : '',
    className: target.className,
    methodName: target.methodName,
  }
  const name = junitName(fields)
  return { ...fields, id: `junit:${fields.module}:${name}`, name, type: 'junit', origin: 'detected', env: {}, workingDirectory: '', vmOptions: '' }
}

function runTest(path: string, target: TestTarget, debug = false): void {
  const configuration = testConfiguration(path, target)
  if (configuration) void runTemporary(configuration, debug ? debugConfiguration : undefined)
}

/** The test at a line: the method whose declaration is the last one at or above it, else its class. */
export function testAt(file: TestFile, line: number): TestTarget | null {
  const owner = [...file.classes].reverse().find((c) => c.line <= line) ?? file.classes[0]
  if (!owner) return null
  const method = [...owner.methods].reverse().find((m) => m.line <= line)
  return method ? { scope: 'method', className: owner.className, methodName: method.name } : { scope: 'class', className: owner.className, methodName: '' }
}

function activeTestFile(): { path: string; tests: TestFile } | null {
  const { tabs, activeTab } = workbench.get()
  const tab = tabs.find((t) => t.path === activeTab)
  if (tab?.kind !== 'file' || !/\.(java|kt)$/.test(tab.path)) return null
  const model = monaco.editor.getModel(monaco.Uri.file(tab.path))
  if (!model) return null
  const tests = findTests(model.getValue())
  return tests.classes.length > 0 ? { path: tab.path, tests } : null
}

export function installTestSupport(): void {
  if (installed) return
  installed = true
  monaco.editor.registerCommand(RUN_TEST_COMMAND, (_accessor, path: string, target: TestTarget) => runTest(path, target))
  monaco.editor.registerCommand(DEBUG_TEST_COMMAND, (_accessor, path: string, target: TestTarget) => runTest(path, target, true))
  for (const language of ['java', 'kotlin']) {
    monaco.languages.registerCodeLensProvider(language, {
      provideCodeLenses(model) {
        if (model.uri.scheme !== 'file') return { lenses: [], dispose: () => undefined }
        const path = model.uri.fsPath
        // Run and Debug side by side, the two items of IntelliJ's run gutter menu.
        const lenses = (line: number, name: string, target: TestTarget): monaco.languages.CodeLens[] => [
          { range: new monaco.Range(line, 1, line, 1), command: { id: RUN_TEST_COMMAND, title: `▶ Run '${name}'`, arguments: [path, target] } },
          { range: new monaco.Range(line, 1, line, 1), command: { id: DEBUG_TEST_COMMAND, title: 'Debug', arguments: [path, target] } },
        ]
        const result = findTests(model.getValue()).classes.flatMap((c) => {
          const simple = c.className.slice(c.className.lastIndexOf('.') + 1)
          return [
            ...lenses(c.line, simple, { scope: 'class', className: c.className, methodName: '' }),
            ...c.methods.flatMap((m) => lenses(m.line, `${m.name}()`, { scope: 'method', className: c.className, methodName: m.name })),
          ]
        })
        return { lenses: result, dispose: () => undefined }
      },
    })
  }
  actions.register({
    id: 'DebugClass',
    text: 'Debug Context Configuration',
    isEnabled: (context) => context.focusArea === 'editor' && activeTestFile() !== null,
    perform: () => {
      const file = activeTestFile()
      const target = file && testAt(file.tests, workbench.get().caret?.line ?? 1)
      if (file && target) runTest(file.path, target, true)
    },
  })
  actions.register({
    id: 'RunClass',
    text: 'Run Context Configuration',
    isEnabled: (context) => context.focusArea === 'editor' && activeTestFile() !== null,
    perform: () => {
      const file = activeTestFile()
      const target = file && testAt(file.tests, workbench.get().caret?.line ?? 1)
      if (file && target) runTest(file.path, target)
    },
  })
}
