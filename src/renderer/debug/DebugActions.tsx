import { useEffect } from 'react'
import { basename } from '@shared/paths'
import { requestReveal } from '../editor/documents'
import { useActions } from '../keymap/service'
import { selectedConfiguration } from '../run/runState'
import { createStore, useStore } from '../state/store'
import { openFile, showToolWindow, workbench } from '../state/workbench'
import { currentDebugGroup, currentRunGroup } from '../terminal/ptySessions'
import { Icon } from '../ui/Icon'
import { breakpointState, removeBreakpoint, setBreakpointEnabled, setBreakpointsMuted, toggleBreakpoint } from './breakpoints'
import { activeSession, executionPoint } from './debugState'
import { evaluateFocus, showConsoleTab } from './DebugView'
import { installDebugEditorSupport } from './editorDebug'
import { canDebug, debugConfiguration } from './launch'

const breakpointsDialog = createStore({ open: false })

/** The file and caret line of the active editor tab. */
function editorLine(): { path: string; line: number } | null {
  const { tabs, activeTab, caret } = workbench.get()
  const tab = tabs.find((t) => t.path === activeTab)
  return tab?.kind === 'file' && caret ? { path: tab.path, line: caret.line } : null
}

/** Stops the debug session; its console process too. */
async function stopSession(): Promise<void> {
  const session = activeSession()
  if (!session) return
  if (session.consoleId) currentDebugGroup().stop(session.consoleId)
  await session.stop()
}

/**
 * Debugger actions with IntelliJ's ids and shortcuts (Debug ⌃D, Resume ⌥⌘R, Step Over F8…) and
 * the View Breakpoints dialog.
 */
export function DebugActions() {
  const open = useStore(breakpointsDialog, (s) => s.open)
  useEffect(() => installDebugEditorSupport(), [])

  useActions(() => {
    const paused = (): boolean => activeSession()?.paused ?? false
    const live = (): boolean => activeSession()?.active ?? false
    const inDebugWindow = (): boolean => document.activeElement?.closest('[data-tool-window="Debug"]') !== null
    return [
      { id: 'Debug', isEnabled: () => canDebug(selectedConfiguration()), perform: () => void debugConfiguration(selectedConfiguration()!) },
      { id: 'Resume', isEnabled: paused, perform: () => activeSession()?.resume() },
      { id: 'Pause', isEnabled: () => live() && !paused(), perform: () => activeSession()?.pause() },
      { id: 'StepOver', isEnabled: paused, perform: () => activeSession()?.stepOver() },
      { id: 'StepInto', isEnabled: paused, perform: () => activeSession()?.stepInto() },
      // No smart/forced variants in DAP: they step into like Step Into.
      { id: 'SmartStepInto', isEnabled: paused, perform: () => activeSession()?.stepInto() },
      { id: 'ForceStepInto', isEnabled: paused, perform: () => activeSession()?.stepInto() },
      { id: 'StepOut', isEnabled: paused, perform: () => activeSession()?.stepOut() },
      {
        id: 'RunToCursor',
        isEnabled: () => paused() && editorLine() !== null,
        perform: () => {
          const target = editorLine()
          if (target) activeSession()?.runToCursor(target.path, target.line)
        },
      },
      {
        id: 'EvaluateExpression',
        isEnabled: paused,
        perform: () => {
          showToolWindow('Debug', false)
          setTimeout(() => evaluateFocus.request(), 0)
        },
      },
      {
        id: 'ShowExecutionPoint',
        isEnabled: () => executionPoint.get().point !== null,
        perform: () => {
          const point = executionPoint.get().point
          if (!point) return
          openFile(point.path)
          requestReveal(point.path, { startLineNumber: point.line, startColumn: 1, endLineNumber: point.line, endColumn: 1 })
        },
      },
      // Stop belongs to the debugger when its window has focus or nothing else runs.
      {
        id: 'Stop',
        isEnabled: () => live() && (inDebugWindow() || !(currentRunGroup().activeInfo()?.running ?? false)),
        perform: () => void stopSession(),
      },
      {
        id: 'Rerun',
        isEnabled: () => inDebugWindow() && activeSession() !== undefined,
        perform: () => {
          const session = activeSession()
          if (!session) return
          void stopSession().then(() => session.restart())
        },
      },
      {
        id: 'ToggleLineBreakpoint',
        isEnabled: (c) => c.focusArea === 'editor' && editorLine() !== null,
        perform: () => {
          const target = editorLine()
          if (target) toggleBreakpoint(target.path, target.line)
        },
      },
      { id: 'ViewBreakpoints', perform: () => breakpointsDialog.set({ open: true }) },
      { id: 'XDebugger.MuteBreakpoints', text: 'Mute Breakpoints', perform: () => setBreakpointsMuted(!breakpointState.get().muted) },
      {
        id: 'AnyCode.ShowDebugConsole',
        text: 'Show Debug Console',
        isEnabled: () => activeSession() !== undefined,
        perform: () => {
          showToolWindow('Debug')
          showConsoleTab.request()
        },
      },
    ]
  }, [])

  return open ? <BreakpointsDialog /> : null
}

/** View Breakpoints (⇧⌘F8): every line breakpoint, to enable, disable, remove or jump to. */
function BreakpointsDialog() {
  const byPath = useStore(breakpointState, (s) => s.byPath)
  const muted = useStore(breakpointState, (s) => s.muted)
  const close = (): void => breakpointsDialog.set({ open: false })
  const list = [...byPath.values()].flat()

  useActions(
    () => [
      { id: 'Popup.Cancel', isEnabled: (c) => c.focusArea === 'dialog', perform: close },
      { id: 'Popup.Confirm', isEnabled: (c) => c.focusArea === 'dialog', perform: close },
    ],
    [],
  )

  return (
    <div className="popup-backdrop" onMouseDown={close}>
      <div className="dialog breakpoints-dialog" role="dialog" aria-label="Breakpoints" data-focus-area="dialog" tabIndex={-1} ref={(e) => e?.focus()} onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-title">Breakpoints</div>
        <div className="breakpoints-list" role="list">
          {list.length === 0 && <div className="empty-state">No breakpoints. Add one with the gutter or ⌘F8.</div>}
          {list.map((b) => (
            <div key={`${b.path}:${b.line}`} role="listitem" className="tree-row">
              <input
                type="checkbox"
                aria-label={`Enable ${basename(b.path)}:${b.line}`}
                checked={b.enabled}
                onChange={(e) => setBreakpointEnabled(b.path, b.line, e.target.checked)}
              />
              <Icon name={b.enabled ? 'breakpoints/breakpoint' : 'breakpoints/breakpointDisabled'} />
              <span
                className="breakpoint-location"
                onDoubleClick={() => {
                  close()
                  openFile(b.path)
                  requestReveal(b.path, { startLineNumber: b.line, startColumn: 1, endLineNumber: b.line, endColumn: 1 })
                }}
              >
                {basename(b.path)}:{b.line}
              </span>
              <span className="hint">{b.path}</span>
              <button className="icon-button small" title="Remove" onClick={() => removeBreakpoint(b.path, b.line)}>
                <Icon name="general/remove" size={14} />
              </button>
            </div>
          ))}
        </div>
        <div className="dialog-footer">
          <label className="checkbox-field">
            <input type="checkbox" checked={muted} onChange={(e) => setBreakpointsMuted(e.target.checked)} />
            Mute breakpoints
          </label>
          <span className="toolbar-spacer" />
          <button className="button primary" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
