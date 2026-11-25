import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import '@xterm/xterm/css/xterm.css'
import { useActions } from '../keymap/service'
import { notify } from '../state/notifications'
import { useStore } from '../state/store'
import { showToolWindow, workbench } from '../state/workbench'
import { Icon } from '../ui/Icon'
import { currentTerminalGroup, terminalGroupFor, useTerminalGroup, type SessionGroup } from './ptySessions'

function shellTitle(group: SessionGroup): string {
  const locals = group.titles().filter((t) => t.startsWith('Local')).length
  return locals === 0 ? 'Local' : `Local (${locals + 1})`
}

async function newAgentSession(root: string): Promise<void> {
  showToolWindow('Terminal')
  if (await startAgentSession(root)) terminalGroupFor(root).focusActive()
  else notify('warning', 'No agent command', 'Set the agent command in Settings › Tools › Terminal.')
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

/** Projects whose first terminal tab was opened; each project gets one, once. */
const terminalStarted = new Set<string>()

/** Projects that came from another window: their `claude` picks up the conversation it had there. */
const resumeRequested = new Set<string>()

export function resumeAgent(root: string): void {
  resumeRequested.add(root)
}

const AGENT_TAG = 'agent'

/** Stops reporting a project's agent state to the main process. */
const agentWatchers = new Map<string, () => void>()

const quote = (word: string): string => (/^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`)

/** Whether the project has a running agent session (its conversation resumes if the project moves). */
export function agentRunning(root: string): boolean {
  const agent = terminalGroupFor(root).findByTag(AGENT_TAG)
  return agent !== undefined && !agent.exited
}

/** Tells the main process whether the agent runs, whenever the project's terminal tabs change. */
function watchAgent(root: string): void {
  if (agentWatchers.has(root)) return
  const group = terminalGroupFor(root)
  let reported = false
  const report = (): void => {
    const running = agentRunning(root)
    if (running === reported) return
    reported = running
    window.anycode.send('project:agentState', root, running)
  }
  agentWatchers.set(root, group.store.subscribe(report))
  report()
}

/**
 * New Claude Session: `claude` (or the configured agent command) in a new terminal tab at the
 * project root. With `resume`, `claude --continue` picks up the folder's latest conversation.
 */
export async function startAgentSession(root: string, resume = false): Promise<boolean> {
  const { agentCommand } = await window.anycode.invoke('app:info')
  if (!agentCommand) return false
  const group = terminalGroupFor(root)
  const isClaude = agentCommand[0]?.split('/').pop() === 'claude'
  const title = isClaude ? 'Claude' : agentCommand.join(' ')
  if (isClaude && resume) {
    // claude --continue resumes the folder's latest conversation; without one it starts afresh.
    const line = agentCommand.map(quote).join(' ')
    await group.create({ title, cwd: root, script: `${line} --continue || exec ${line}`, tag: AGENT_TAG })
  } else await group.create({ title, cwd: root, command: agentCommand, tag: AGENT_TAG })
  watchAgent(root)
  return true
}

/** The agent is configured (Settings › Tools › Terminal › Agent command). */
export async function agentAvailable(): Promise<boolean> {
  return (await window.anycode.invoke('app:info')).agentCommand !== null
}

/**
 * The project's first terminal tab: a plain shell, or the agent when "Start the agent when a project
 * opens" is on. A project moved from another window with its agent running gets it back, resumed.
 */
async function startTerminal(root: string): Promise<void> {
  if (terminalStarted.has(root)) return
  terminalStarted.add(root)
  const { startAgent } = await window.anycode.invoke('app:info')
  const resume = resumeRequested.delete(root)
  if ((resume || startAgent) && (await startAgentSession(root, resume))) return
  const group = terminalGroupFor(root)
  await group.create({ title: shellTitle(group), cwd: root })
}

/** A closed project's first tab starts again if the project is reopened. */
export function forgetAgent(root: string): void {
  terminalStarted.delete(root)
  agentWatchers.get(root)?.()
  agentWatchers.delete(root)
}

/** Session tabs shown in the Terminal tool window header. */
export function TerminalTabs() {
  const group = useTerminalGroup()
  const { list, active } = useStore(group.store, (s) => s)
  const project = useStore(workbench, (s) => s.project)
  const [hasAgent, setHasAgent] = useState(false)
  useEffect(() => {
    void agentAvailable().then(setHasAgent)
  }, [])
  return (
    <div className="tool-window-tabs">
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
      {project && hasAgent && (
        <button className="icon-button labeled" title="New Claude Session" onClick={() => void newAgentSession(project.root)}>
          Claude
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
    if (project) void startTerminal(project.root)
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
        id: 'AnyCode.NewAgentSession',
        text: 'New Claude Session',
        isEnabled: () => workbench.get().project !== null,
        perform: () => {
          const root = workbench.get().project?.root
          if (root) void newAgentSession(root)
        },
      },
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
