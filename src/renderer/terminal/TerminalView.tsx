import { useEffect, useLayoutEffect, useRef } from 'react'
import '@xterm/xterm/css/xterm.css'
import { useActions } from '../keymap/service'
import { useStore } from '../state/store'
import { showToolWindow, workbench } from '../state/workbench'
import { Icon } from '../ui/Icon'
import { currentTerminalGroup, terminalGroupFor, useTerminalGroup, type SessionGroup } from './ptySessions'

function shellTitle(group: SessionGroup): string {
  const locals = group.titles().filter((t) => t.startsWith('Local')).length
  return locals === 0 ? 'Local' : `Local (${locals + 1})`
}

async function newShell(root: string): Promise<void> {
  const group = terminalGroupFor(root)
  await group.create({ title: shellTitle(group), cwd: root })
  group.focusActive()
}

/**
 * Runs commands in a new terminal tab of the current project (Markdown "Run in Terminal"). The tab
 * is an interactive shell, so it stays open with the output and a prompt afterwards.
 */
export async function runInNewTerminal(command: string, cwd: string): Promise<void> {
  const root = workbench.get().project?.root
  if (!root) return
  const group = terminalGroupFor(root)
  const firstLine = command.split('\n')[0] ?? command
  const title = firstLine.length > 28 ? `${firstLine.slice(0, 27)}…` : firstLine
  showToolWindow('Terminal')
  const id = await group.create({ title, cwd })
  group.write(id, `${command}\r`)
  group.focusActive()
}

/** Projects whose agent tab was started; each project gets one, once. */
const agentStarted = new Set<string>()

/** The agent tab: `claude` (or ANYCODE_AGENT_COMMAND) in the project root. */
async function startAgent(root: string): Promise<void> {
  if (agentStarted.has(root)) return
  agentStarted.add(root)
  const group = terminalGroupFor(root)
  const { agentCommand } = await window.anycode.invoke('app:info')
  if (agentCommand) {
    const title = agentCommand[0] === 'claude' ? 'Claude' : agentCommand.join(' ')
    await group.create({ title, cwd: root, command: agentCommand })
  } else await group.create({ title: shellTitle(group), cwd: root })
}

/** A closed project's agent starts again if the project is reopened. */
export function forgetAgent(root: string): void {
  agentStarted.delete(root)
}

/** Session tabs shown in the Terminal tool window header. */
export function TerminalTabs() {
  const group = useTerminalGroup()
  const { list, active } = useStore(group.store, (s) => s)
  const project = useStore(workbench, (s) => s.project)
  const attached = useStore(workbench, (s) => s.projects.length > 1)
  return (
    <div className="tool-window-tabs">
      {/* With attached projects, the sessions shown are the current project's. */}
      {attached && project && (
        <span className="tool-window-project" title={project.root}>
          {project.name}
        </span>
      )}
      {list.map((session) => (
        <div
          key={session.id}
          className={`tool-window-tab${session.id === active ? ' selected' : ''}`}
          onMouseDown={() => group.activate(session.id)}
        >
          <span>{session.title}</span>
          <button className="icon-button small tab-close" title="Close Session" onClick={() => group.close(session.id)}>
            <Icon name="general/closeSmall" size={14} />
          </button>
        </div>
      ))}
      {project && (
        <button className="icon-button" title="New Tab" onClick={() => void newShell(project.root)}>
          <Icon name="general/add" />
        </button>
      )}
    </div>
  )
}

/** Mounted once per project (keyed by root), so the host only ever holds that project's sessions. */
export function TerminalView({ visible }: { visible: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const project = useStore(workbench, (s) => s.project)
  const group = useTerminalGroup()
  const { list, active } = useStore(group.store, (s) => s)
  const focus = useStore(workbench, (s) => s.focus)

  // Before any effect creates a session, so new terminals are measured first.
  useLayoutEffect(() => {
    if (host.current) group.attach(host.current)
  })

  useEffect(() => {
    if (project) void startAgent(project.root)
  }, [project])

  useEffect(() => {
    if (host.current) group.mount(host.current)
  }, [group, list, active, visible])

  useEffect(() => {
    if (!host.current) return
    const observer = new ResizeObserver(() => group.fitActive())
    observer.observe(host.current)
    return () => observer.disconnect()
  }, [group])

  useEffect(() => {
    if (visible && focus.target === 'Terminal') group.focusActive()
  }, [group, focus, visible, active])

  useActions(() => {
    const inTerminal = (context: { focusArea: string }) => context.focusArea === 'terminal'
    return [
      {
        id: 'Terminal.NewTab',
        isEnabled: inTerminal,
        perform: () => {
          const root = workbench.get().project?.root
          if (root) void newShell(root)
        },
      },
      {
        id: 'Terminal.CloseTab',
        isEnabled: inTerminal,
        perform: () => {
          const g = currentTerminalGroup()
          const id = g.store.get().active
          if (id) g.close(id)
          g.focusActive()
        },
      },
      {
        id: 'Terminal.CopySelectedText',
        isEnabled: (c) => inTerminal(c) && currentTerminalGroup().hasSelection(),
        perform: () => currentTerminalGroup().copySelection(),
      },
      { id: 'Terminal.Paste', isEnabled: inTerminal, perform: () => void currentTerminalGroup().paste() },
      { id: 'Terminal.ClearBuffer', isEnabled: inTerminal, perform: () => currentTerminalGroup().clear() },
      {
        id: 'NextTab',
        isEnabled: inTerminal,
        perform: () => {
          currentTerminalGroup().selectAdjacent(1)
          currentTerminalGroup().focusActive()
        },
      },
      {
        id: 'PreviousTab',
        isEnabled: inTerminal,
        perform: () => {
          currentTerminalGroup().selectAdjacent(-1)
          currentTerminalGroup().focusActive()
        },
      },
    ]
  }, [])

  return <div className="terminal-host" ref={host} data-focus-area="terminal" />
}
