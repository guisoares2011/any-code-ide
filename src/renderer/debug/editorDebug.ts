// The debugger in the editor: breakpoints in the gutter (click or ⌘F8), the execution point, and
// variable values on hover while the program is paused. Decorations live on the models, so every
// editor showing a file shows them.
import * as monaco from 'monaco-editor'
import { requestReveal } from '../editor/documents'
import { openFile } from '../state/workbench'
import { iconUrl } from '../ui/icons'
import { breakpointsOf, breakpointState, moveBreakpoints, toggleBreakpoint } from './breakpoints'
import { activeSession, executionPoint } from './debugState'

const decorations = new Map<monaco.editor.ITextModel, { breakpoints: string[]; execution: string[] }>()
let installed = false

const pathOf = (model: monaco.editor.ITextModel): string | null => (model.uri.scheme === 'file' ? model.uri.fsPath : null)

function breakpointDecorations(model: monaco.editor.ITextModel, path: string): monaco.editor.IModelDeltaDecoration[] {
  const muted = breakpointState.get().muted
  return breakpointsOf(path).map((b) => {
    const line = Math.min(b.line, model.getLineCount())
    const state = muted ? 'muted' : !b.enabled ? 'disabled' : b.verified === false ? 'invalid' : b.verified ? 'valid' : 'set'
    return {
      // The whole line, so text typed at its start pushes the breakpoint down with the code.
      range: new monaco.Range(line, 1, line, model.getLineMaxColumn(line)),
      options: {
        isWholeLine: true,
        glyphMarginClassName: `debug-breakpoint-glyph ${state}`,
        glyphMarginHoverMessage: { value: b.enabled ? 'Line breakpoint' : 'Line breakpoint (disabled)' },
        className: b.enabled && !muted ? 'debug-breakpoint-line' : undefined,
        stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      },
    }
  })
}

function executionDecorations(path: string): monaco.editor.IModelDeltaDecoration[] {
  const point = executionPoint.get().point
  if (point?.path !== path) return []
  return [
    {
      range: new monaco.Range(point.line, 1, point.line, 1),
      options: {
        isWholeLine: true,
        className: point.top ? 'debug-execution-line' : 'debug-frame-line',
        linesDecorationsClassName: 'debug-execution-glyph',
        zIndex: 10,
      },
    },
  ]
}

function refresh(model: monaco.editor.ITextModel): void {
  const path = pathOf(model)
  if (!path || model.isDisposed()) return
  const current = decorations.get(model) ?? { breakpoints: [], execution: [] }
  decorations.set(model, {
    breakpoints: model.deltaDecorations(current.breakpoints, breakpointDecorations(model, path)),
    execution: model.deltaDecorations(current.execution, executionDecorations(path)),
  })
}

/** Breakpoints follow their lines while the file is edited. */
function track(model: monaco.editor.ITextModel): void {
  const path = pathOf(model)
  if (!path) return
  refresh(model)
  model.onDidChangeContent(() => {
    const ids = decorations.get(model)?.breakpoints ?? []
    const list = breakpointsOf(path)
    const lines = new Map<number, number>()
    ids.forEach((id, index) => {
      const range = model.getDecorationRange(id)
      const before = list[index]?.line
      if (range && before !== undefined && range.startLineNumber !== before) lines.set(before, range.startLineNumber)
    })
    if (lines.size > 0) moveBreakpoints(path, lines)
  })
  model.onWillDispose(() => decorations.delete(model))
}

/** Gutter clicks of an editor toggle breakpoints, like clicking IntelliJ's gutter. */
export function attachBreakpointGutter(editor: monaco.editor.IStandaloneCodeEditor): monaco.IDisposable {
  return editor.onMouseDown((event) => {
    const { type, position } = event.target
    const gutter = type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN || type === monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS
    const model = editor.getModel()
    const path = model && pathOf(model)
    if (!gutter || !position || !path || !event.event.leftButton) return
    toggleBreakpoint(path, position.lineNumber)
  })
}

/** Variable values on hover while paused (IntelliJ's quick evaluate on hover). */
function hoverProvider(): monaco.languages.HoverProvider {
  return {
    async provideHover(model, position) {
      const session = activeSession()
      const word = model.getWordAtPosition(position)
      if (!session?.paused || !word || pathOf(model) === null) return null
      // Include a qualifier before the word: `user.name` evaluates as a whole.
      const line = model.getLineContent(position.lineNumber)
      const prefix = /[\w$.]*$/.exec(line.slice(0, word.startColumn - 1))?.[0] ?? ''
      const expression = (prefix + word.word).replace(/^\.+/, '')
      try {
        const result = await session.evaluate(expression, 'hover')
        return {
          range: new monaco.Range(position.lineNumber, word.startColumn - prefix.length, position.lineNumber, word.endColumn),
          contents: [{ value: `\`${expression}\` = ${'```'}\n${result.value}\n${'```'}` }],
        }
      } catch {
        return null
      }
    },
  }
}

export function installDebugEditorSupport(): void {
  if (installed) return
  installed = true
  const style = document.documentElement.style
  for (const [variable, icon] of [
    ['--icon-breakpoint', 'breakpoints/breakpoint'],
    ['--icon-breakpoint-valid', 'breakpoints/breakpointValid'],
    ['--icon-breakpoint-disabled', 'breakpoints/breakpointDisabled'],
    ['--icon-breakpoint-invalid', 'breakpoints/breakpointInvalid'],
    ['--icon-breakpoint-muted', 'breakpoints/breakpointMuted'],
    ['--icon-execution-point', 'debugger/nextStatement'],
  ] as const) {
    const url = iconUrl(icon)
    if (url) style.setProperty(variable, `url("${url}")`)
  }
  monaco.editor.getModels().forEach(track)
  monaco.editor.onDidCreateModel(track)
  breakpointState.subscribe(() => monaco.editor.getModels().forEach(refresh))
  let lastSeq = executionPoint.get().seq
  executionPoint.subscribe(() => {
    const { point, seq } = executionPoint.get()
    if (seq === lastSeq) return
    lastSeq = seq
    monaco.editor.getModels().forEach(refresh)
    // Stopping shows where: the file opens at the execution point.
    if (point) {
      openFile(point.path)
      requestReveal(point.path, { startLineNumber: point.line, startColumn: 1, endLineNumber: point.line, endColumn: 1 })
    }
  })
  monaco.languages.registerHoverProvider(['java', 'kotlin', 'javascript', 'typescript'], hoverProvider())
}
