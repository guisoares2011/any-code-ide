import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { basename } from '@shared/paths'
import { requestReveal } from '../editor/documents'
import { performAction, shortcutFor, useActions } from '../keymap/service'
import { useStore } from '../state/store'
import { openFile, workbench } from '../state/workbench'
import { currentDebugGroup, useDebugGroup } from '../terminal/ptySessions'
import { Icon } from '../ui/Icon'
import { TreeView, type TreeNode } from '../ui/TreeView'
import { breakpointState } from './breakpoints'
import type { DapScope, DapVariable } from './dap'
import { activateSession, debugState, removeSession } from './debugState'
import type { DebugSession, DebugSessionState } from './session'

const EMPTY_STATE: DebugSessionState = {
  status: 'terminated',
  message: null,
  threads: [],
  threadId: null,
  reason: null,
  frames: [],
  frameId: null,
  framesError: null,
}

function useActiveSession(): DebugSession | undefined {
  const root = useStore(workbench, (s) => s.project?.root)
  const sessions = useStore(debugState, (s) => s.sessions)
  const active = useStore(debugState, (s) => s.active)
  return useMemo(() => {
    const own = sessions.filter((s) => s.root === root)
    return own.find((s) => s.id === active) ?? own.at(-1)
  }, [sessions, active, root])
}

function useSessionState(session: DebugSession | undefined): DebugSessionState {
  const fallback = useMemo(() => ({ get: () => EMPTY_STATE, subscribe: () => () => undefined, set: () => undefined }), [])
  return useStore(session?.store ?? fallback, (s) => s)
}

/** Closing a tab ends its session and its console. */
function closeSession(session: DebugSession): void {
  if (session.active) void session.stop()
  if (session.consoleId) currentDebugGroup().close(session.consoleId)
  removeSession(session.id)
}

function SessionTab({ session, selected }: { session: DebugSession; selected: boolean }) {
  const state = useSessionState(session)
  const icon = state.status === 'terminated' ? 'run/stop' : state.status === 'paused' ? 'run/pause' : 'run/debug'
  return (
    <div className={`tool-window-tab${selected ? ' selected' : ''}`} data-status={state.status} onMouseDown={() => activateSession(session.id)}>
      <Icon name={icon} size={14} />
      <span>{session.name}</span>
      <button className="icon-button small tab-close" title="Close" onClick={() => closeSession(session)}>
        <Icon name="general/closeSmall" size={14} />
      </button>
    </div>
  )
}

/** Session tabs in the Debug tool window header. */
export function DebugTabs() {
  const root = useStore(workbench, (s) => s.project?.root)
  const sessions = useStore(debugState, (s) => s.sessions)
  const current = useActiveSession()
  return (
    <div className="tool-window-tabs">
      {sessions
        .filter((s) => s.root === root)
        .map((session) => (
          <SessionTab key={session.id} session={session} selected={session === current} />
        ))}
    </div>
  )
}

function ToolbarButton({ actionId, icon, label, enabled }: { actionId: string; icon: string; label: string; enabled: boolean }) {
  const shortcut = shortcutFor(actionId)
  return (
    <button
      className="icon-button"
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-label={label}
      disabled={!enabled}
      style={{ opacity: enabled ? 1 : 0.4 }}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => performAction(actionId)}
    >
      <Icon name={icon} />
    </button>
  )
}

function DebugToolbar({ session, state }: { session: DebugSession | undefined; state: DebugSessionState }) {
  const muted = useStore(breakpointState, (s) => s.muted)
  const paused = state.status === 'paused'
  const live = session !== undefined && state.status !== 'terminated'
  return (
    <div className="debug-toolbar" role="toolbar" aria-label="Debugger">
      <ToolbarButton actionId="Rerun" icon="run/restartDebug" label="Rerun" enabled={session !== undefined} />
      <ToolbarButton actionId="Resume" icon="run/resume" label="Resume Program" enabled={paused} />
      <ToolbarButton actionId="Pause" icon="run/pause" label="Pause Program" enabled={live && !paused && state.status === 'running'} />
      <ToolbarButton actionId="Stop" icon="run/stop" label="Stop" enabled={live} />
      <span className="toolbar-separator" />
      <ToolbarButton actionId="StepOver" icon="run/stepOver" label="Step Over" enabled={paused} />
      <ToolbarButton actionId="StepInto" icon="run/stepInto" label="Step Into" enabled={paused} />
      <ToolbarButton actionId="StepOut" icon="run/stepOut" label="Step Out" enabled={paused} />
      <ToolbarButton actionId="RunToCursor" icon="run/runToCursor" label="Run to Cursor" enabled={paused} />
      <span className="toolbar-separator" />
      <ToolbarButton actionId="EvaluateExpression" icon="run/evaluateExpression" label="Evaluate Expression…" enabled={paused} />
      <ToolbarButton actionId="ShowExecutionPoint" icon="run/showCurrentFrame" label="Show Execution Point" enabled={paused} />
      <span className="toolbar-separator" />
      <ToolbarButton actionId="ViewBreakpoints" icon="run/viewBreakpoints" label="View Breakpoints…" enabled />
      <button
        className={`icon-button${muted ? ' selected' : ''}`}
        title="Mute Breakpoints"
        aria-label="Mute Breakpoints"
        aria-pressed={muted}
        onClick={() => performAction('XDebugger.MuteBreakpoints')}
      >
        <Icon name="run/muteBreakpoints" />
      </button>
      {state.message && <span className="hint debug-message">{state.message}</span>}
      {!state.message && paused && state.reason && <span className="hint debug-message">Paused: {state.reason}</span>}
    </div>
  )
}

function revealFrame(path: string, line: number): void {
  openFile(path)
  requestReveal(path, { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 })
}

function Frames({ session, state }: { session: DebugSession; state: DebugSessionState }) {
  return (
    <div className="debug-frames">
      <select
        className="text-field debug-thread"
        aria-label="Thread"
        value={state.threadId ?? ''}
        disabled={state.status !== 'paused'}
        onChange={(e) => void session.loadFrames(Number(e.target.value))}
      >
        {state.threads.length === 0 && <option value="">{state.status === 'paused' ? 'No threads' : 'Not paused'}</option>}
        {state.threads.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <div className="debug-frame-list" role="listbox" aria-label="Frames" data-focus-area="tree" tabIndex={0}>
        {state.framesError && <div className="hint debug-pad">{state.framesError}</div>}
        {state.status !== 'paused' && state.status !== 'terminated' && <div className="hint debug-pad">The application is running</div>}
        {state.frames.map((frame) => {
          const path = frame.source?.path
          return (
            <div
              key={frame.id}
              role="option"
              aria-selected={frame.id === state.frameId}
              className={`debug-frame${frame.id === state.frameId ? ' selected' : ''}${path ? '' : ' library'}`}
              onClick={() => {
                session.selectFrame(frame.id)
                if (path) revealFrame(path, frame.line)
              }}
            >
              <Icon name="debugger/frame" size={14} />
              <span className="debug-frame-name">{frame.name}</span>
              <span className="hint">
                {frame.source?.name ?? (path ? basename(path) : '')}
                {frame.line ? `:${frame.line}` : ''}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

type Loaded = DapVariable[] | 'loading' | { error: string }

/** The type icon of a value: objects and arrays have children. */
const variableIcon = (v: DapVariable): string =>
  v.variablesReference > 0 ? (/\[\]|Array|List/.test(v.type ?? v.value) ? 'debugger/dbArray' : 'debugger/dbObject') : 'debugger/dbPrimitive'

/** Expression field focus requests (EvaluateExpression ⌥F8). */
export const evaluateFocus = { request: (): void => undefined }

function Variables({ session, state }: { session: DebugSession; state: DebugSessionState }) {
  const [scopes, setScopes] = useState<DapScope[] | null>(null)
  const [children, setChildren] = useState(new Map<number, Loaded>())
  const [results, setResults] = useState<{ id: number; variable: DapVariable | { error: string; name: string } }[]>([])
  const [expression, setExpression] = useState('')
  const field = useRef<HTMLInputElement>(null)
  const frameId = state.frameId
  const paused = state.status === 'paused'

  const evaluateRef = useRef<() => Promise<void>>(async () => undefined)
  useLayoutEffect(() => {
    evaluateFocus.request = () => field.current?.focus()
    evaluateRef.current = evaluate
  })
  // Enter in the expression field: IntelliJ's Console.Execute.
  useActions(
    () => [{ id: 'Console.Execute', isEnabled: () => document.activeElement === field.current, perform: () => void evaluateRef.current() }],
    [],
  )

  // A new frame (or a new stop) loads its scopes and the first scope's variables.
  useEffect(() => {
    setChildren(new Map())
    setScopes(null)
    if (!paused || frameId === null) return
    let cancelled = false
    void session
      .scopes(frameId)
      .then(async (list) => {
        if (cancelled) return
        setScopes(list)
        // Cheap scopes (block, local, closure) load at once and show open; Global waits for a click.
        await Promise.all(
          list
            .filter((s) => !s.expensive)
            .map(async (scope) => {
              const variables = await session.variables(scope.variablesReference)
              if (!cancelled) setChildren((prev) => new Map(prev).set(scope.variablesReference, variables))
            }),
        )
      })
      .catch(() => !cancelled && setScopes([]))
    return () => {
      cancelled = true
    }
  }, [session, frameId, paused])

  const load = (reference: number): void => {
    if (children.has(reference)) return
    setChildren((prev) => new Map(prev).set(reference, 'loading'))
    void session
      .variables(reference)
      .then((variables) => setChildren((prev) => new Map(prev).set(reference, variables)))
      .catch((error: Error) => setChildren((prev) => new Map(prev).set(reference, { error: error.message })))
  }

  const variableNode = (variable: DapVariable, key: string, className?: string): TreeNode => ({
    id: key,
    label: (
      <span className={className}>
        <span className="debug-variable-name">{variable.name}</span>
        <span className="debug-variable-value"> = {variable.type && variable.variablesReference > 0 ? `{${variable.type}} ` : ''}{variable.value}</span>
      </span>
    ),
    icon: variableIcon(variable),
    title: variable.value,
    ...(variable.variablesReference > 0
      ? { children: () => childNodes(variable.variablesReference, key), onExpand: () => load(variable.variablesReference) }
      : {}),
  })

  const childNodes = (reference: number, parentKey: string): TreeNode[] => {
    const loaded = children.get(reference)
    if (!loaded || loaded === 'loading') return [{ id: `${parentKey}/loading`, label: <span className="hint">Collecting data…</span> }]
    if ('error' in loaded) return [{ id: `${parentKey}/error`, label: <span className="field-error">{loaded.error}</span> }]
    return loaded.map((v, i) => variableNode(v, `${parentKey}/${i}:${v.name}`))
  }

  const nodes: TreeNode[] = []
  for (const { id, variable } of results) {
    nodes.push(
      'error' in variable
        ? { id: `result:${id}`, label: <span className="field-error">{variable.name}: {variable.error}</span>, icon: 'debugger/evaluationResult' }
        : { ...variableNode(variable, `result:${id}`, 'debug-result'), icon: 'debugger/evaluationResult' },
    )
  }
  if (scopes) {
    const [first, ...rest] = scopes
    // The first scope (Local) is shown flat, like IntelliJ's Variables; the others as groups.
    if (first) nodes.push(...childNodes(first.variablesReference, `scope:${first.name}`))
    for (const scope of rest) {
      nodes.push({
        id: `scope:${scope.name}`,
        label: scope.name,
        icon: 'debugger/watch',
        children: () => childNodes(scope.variablesReference, `scope:${scope.name}`),
        onExpand: () => load(scope.variablesReference),
      })
    }
  }

  const evaluate = async (): Promise<void> => {
    const text = expression.trim()
    if (!text || !paused) return
    const id = Date.now()
    try {
      const variable = await session.evaluate(text, 'repl')
      setResults((prev) => [{ id, variable }, ...prev.slice(0, 9)])
    } catch (error) {
      setResults((prev) => [{ id, variable: { name: text, error: error instanceof Error ? error.message : String(error) } }, ...prev.slice(0, 9)])
    }
  }

  return (
    <div className="debug-variables">
      <input
        ref={field}
        className="text-field debug-evaluate"
        aria-label="Evaluate expression"
        placeholder={paused ? 'Evaluate expression (↩)' : 'Evaluate expression when paused'}
        value={expression}
        disabled={!paused}
        spellCheck={false}
        onChange={(e) => setExpression(e.target.value)}
      />
      <div className="debug-variable-tree">
        {paused ? (
          <TreeView
            key={`${state.frameId}:${scopes?.length ?? 0}`}
            nodes={nodes}
            label="Variables"
            initiallyExpanded={(scopes ?? []).slice(1).filter((s) => !s.expensive).map((s) => `scope:${s.name}`)}
          />
        ) : (
          <div className="empty-state">{state.status === 'terminated' ? 'The session ended' : 'Variables are shown when the program pauses'}</div>
        )}
      </div>
    </div>
  )
}

function ConsoleHost({ session, visible }: { session: DebugSession | undefined; visible: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const group = useDebugGroup()
  const { list } = useStore(group.store, (s) => s)

  useLayoutEffect(() => {
    if (host.current) group.attach(host.current)
  })

  useEffect(() => {
    if (session?.consoleId) group.activate(session.consoleId)
    if (host.current) group.mount(host.current)
  }, [group, session, list, visible])

  useEffect(() => {
    if (!host.current) return
    const observer = new ResizeObserver(() => group.fitActive())
    observer.observe(host.current)
    return () => observer.disconnect()
  }, [group])

  return <div className="terminal-host debug-console" ref={host} data-focus-area="other" />
}

type Tab = 'debugger' | 'console'

/** Mounted once per project (keyed by root), like the Run tool window. */
export function DebugView({ visible }: { visible: boolean }) {
  const session = useActiveSession()
  const state = useSessionState(session)
  const [tab, setTab] = useState<Tab>('debugger')

  // Pausing brings the frames and variables to the front.
  const [lastStatus, setLastStatus] = useState(state.status)
  if (state.status !== lastStatus) {
    setLastStatus(state.status)
    if (state.status === 'paused') setTab('debugger')
  }

  useLayoutEffect(() => {
    showConsoleTab.request = () => setTab('console')
  })

  if (!session) {
    return (
      <div className="empty-state">
        No debug session.
        <br />
        Choose a configuration and press {shortcutFor('Debug') ?? ''}, or set a breakpoint with {shortcutFor('ToggleLineBreakpoint') ?? ''}.
      </div>
    )
  }
  return (
    <div className="debug-view">
      <DebugToolbar session={session} state={state} />
      <div className="debug-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'debugger'} className={`popup-tab${tab === 'debugger' ? ' selected' : ''}`} onClick={() => setTab('debugger')}>
          Threads &amp; Variables
        </button>
        <button role="tab" aria-selected={tab === 'console'} className={`popup-tab${tab === 'console' ? ' selected' : ''}`} onClick={() => setTab('console')}>
          Console
        </button>
      </div>
      <div className="debug-body">
        <div className="debug-panes" style={{ display: tab === 'debugger' ? undefined : 'none' }}>
          <Frames session={session} state={state} />
          <Variables session={session} state={state} />
        </div>
        <div className="debug-console-pane" style={{ display: tab === 'console' ? undefined : 'none' }}>
          <ConsoleHost session={session} visible={visible && tab === 'console'} />
        </div>
      </div>
    </div>
  )
}

export const showConsoleTab = { request: (): void => undefined }
