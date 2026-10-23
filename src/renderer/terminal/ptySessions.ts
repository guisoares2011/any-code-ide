// PTY-backed xterm sessions, grouped by tool window (Terminal, Run). Sessions live outside React
// so they survive hiding the tool window or switching tabs; each owns an xterm instance mounted
// in its own element and the view only re-parents it.
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import type { PtyCreateOptions, PtyExit } from '@shared/ipc'
import { createStore, useStore, type Store } from '../state/store'
import { workbench } from '../state/workbench'
import { loadIslandsDarkScheme } from '../theme/islandsDark'
import { terminalThemeFromScheme } from '../theme/terminalTheme'

export interface SessionInfo {
  id: string
  title: string
  exited: boolean
  exitCode: number | null
}

export interface SessionStart {
  title: string
  cwd: string
  /** Command line; omitted for an interactive login shell. */
  command?: string[]
  /** Extra state kept with the session, e.g. the run configuration. */
  tag?: string
}

interface Session extends SessionInfo {
  term: Terminal
  fit: FitAddon
  element: HTMLDivElement
  ptyId: string | null
  start: SessionStart
}

export interface SessionGroupState {
  list: SessionInfo[]
  active: string | null
}

const byPty = new Map<string, { session: Session; group: SessionGroup }>()
let listening = false
let counter = 0

function listen(): void {
  if (listening) return
  listening = true
  window.anycode.on('pty:data', (ptyId, data) => byPty.get(ptyId)?.session.term.write(data))
  window.anycode.on('pty:exit', (exit: PtyExit) => {
    const owner = byPty.get(exit.id)
    if (!owner) return
    byPty.delete(exit.id)
    owner.group.markExited(owner.session, exit.exitCode)
  })
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

export class SessionGroup {
  readonly store: Store<SessionGroupState> = createStore<SessionGroupState>({ list: [], active: null })
  private readonly sessions = new Map<string, Session>()
  private host: HTMLElement | null = null

  constructor(readonly name: string) {}

  /**
   * Element the sessions render into. Set it before creating sessions so a new terminal is measured
   * before its process starts: full-screen programs (claude) then draw for the real size from the
   * first frame instead of 80x24.
   */
  attach(host: HTMLElement): void {
    this.host = host
  }

  async create(start: SessionStart): Promise<string> {
    listen()
    const term = new Terminal({
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 10_000,
      theme: terminalThemeFromScheme(loadIslandsDarkScheme(), cssVar('--c-container-tool-window-bg')),
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    const element = document.createElement('div')
    element.className = 'terminal-session'
    element.style.height = '100%'
    const id = `${this.name}-${++counter}`
    const session: Session = { id, title: start.title, exited: false, exitCode: null, term, fit, element, ptyId: null, start }
    this.sessions.set(id, session)
    this.store.set({ active: id })
    this.publish()
    if (this.host) {
      for (const other of this.sessions.values()) other.element.style.display = 'none'
      this.host.appendChild(element)
    }
    term.open(element)
    if (element.offsetParent !== null) fit.fit()
    // Terminal key encoding, not an IDE shortcut: xterm.js 6 has no kitty keyboard protocol, so
    // Shift+Enter would arrive as a plain Enter. Send LF (what Ctrl+J sends), the newline Claude Code
    // documents for every terminal; shells treat it like Enter.
    term.attachCustomKeyEventHandler((event) => {
      const shiftEnter = event.key === 'Enter' && event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey
      if (!shiftEnter) return true
      if (event.type === 'keydown' && session.ptyId) void window.anycode.invoke('pty:write', session.ptyId, '\n')
      return false
    })
    // Registered before spawning: a fit that lands while the process starts must still reach it.
    term.onResize(({ cols, rows }) => {
      if (session.ptyId) void window.anycode.invoke('pty:resize', session.ptyId, cols, rows)
    })
    term.onData((data) => {
      if (session.ptyId) void window.anycode.invoke('pty:write', session.ptyId, data)
    })
    await this.spawn(session)
    return id
  }

  private async spawn(session: Session): Promise<void> {
    const options: PtyCreateOptions = {
      cwd: session.start.cwd,
      cols: session.term.cols,
      rows: session.term.rows,
      ...(session.start.command ? { command: session.start.command } : {}),
    }
    const ptyId = await window.anycode.invoke('pty:create', options)
    session.ptyId = ptyId
    // The terminal may have been fitted while the process was starting (cell size is only known
    // after the first render); full-screen programs need the real size right away.
    const { cols, rows } = session.term
    if (cols !== options.cols || rows !== options.rows) void window.anycode.invoke('pty:resize', ptyId, cols, rows)
    session.exited = false
    session.exitCode = null
    byPty.set(ptyId, { session, group: this })
    this.publish()
  }

  /** Starts the session's command again in the same tab (Rerun). */
  async restart(id: string): Promise<void> {
    const session = this.sessions.get(id)
    if (!session) return
    if (session.ptyId) await this.stopAndWait(session)
    session.term.reset()
    await this.spawn(session)
  }

  private stopAndWait(session: Session): Promise<void> {
    return new Promise((resolve) => {
      const ptyId = session.ptyId
      if (!ptyId) return resolve()
      const unsubscribe = window.anycode.on('pty:exit', (exit) => {
        if (exit.id === ptyId) {
          unsubscribe()
          resolve()
        }
      })
      void window.anycode.invoke('pty:stop', ptyId)
    })
  }

  markExited(session: Session, exitCode: number): void {
    session.ptyId = null
    session.exited = true
    session.exitCode = exitCode
    session.term.write(`\r\n\x1b[2mProcess finished with exit code ${exitCode}\x1b[0m\r\n`)
    this.publish()
  }

  /** Graceful stop: interrupt, then kill the process group if it does not exit. */
  stop(id: string): void {
    const ptyId = this.sessions.get(id)?.ptyId
    if (ptyId) void window.anycode.invoke('pty:stop', ptyId)
  }

  close(id: string): void {
    const session = this.sessions.get(id)
    if (!session) return
    if (session.ptyId) {
      void window.anycode.invoke('pty:kill', session.ptyId)
      byPty.delete(session.ptyId)
    }
    session.term.dispose()
    session.element.remove()
    this.sessions.delete(id)
    this.publish()
  }

  activate(id: string): void {
    if (this.sessions.has(id)) this.store.set({ active: id })
  }

  selectAdjacent(delta: 1 | -1): void {
    const ids = [...this.sessions.keys()]
    const index = ids.indexOf(this.store.get().active ?? '')
    const next = ids[(index + delta + ids.length) % ids.length]
    if (next) this.activate(next)
  }

  /** Mounts every session element under `host`, showing only the active one, and fits it. */
  mount(host: HTMLElement): void {
    this.host = host
    const active = this.store.get().active
    for (const session of this.sessions.values()) {
      if (session.element.parentElement !== host) host.appendChild(session.element)
      session.element.style.display = session.id === active ? 'block' : 'none'
    }
    this.fitActive()
  }

  fitActive(): void {
    const session = this.active()
    if (session && session.element.offsetParent !== null) session.fit.fit()
  }

  focusActive(): void {
    this.active()?.term.focus()
  }

  activeInfo(): (SessionInfo & { tag?: string; running: boolean }) | undefined {
    const session = this.active()
    return session && { ...this.info(session), tag: session.start.tag, running: session.ptyId !== null }
  }

  findByTag(tag: string): SessionInfo | undefined {
    const session = [...this.sessions.values()].find((s) => s.start.tag === tag)
    return session && this.info(session)
  }

  isRunning(id: string): boolean {
    return this.sessions.get(id)?.ptyId != null
  }

  count(): number {
    return this.sessions.size
  }

  titles(): string[] {
    return [...this.sessions.values()].map((s) => s.title)
  }

  copySelection(): boolean {
    const selection = this.active()?.term.getSelection()
    if (!selection) return false
    void navigator.clipboard.writeText(selection)
    return true
  }

  hasSelection(): boolean {
    return this.active()?.term.hasSelection() ?? false
  }

  async paste(): Promise<void> {
    const text = await navigator.clipboard.readText()
    this.active()?.term.paste(text)
  }

  clear(): void {
    this.active()?.term.clear()
  }

  private active(): Session | undefined {
    const id = this.store.get().active
    return id ? this.sessions.get(id) : undefined
  }

  private info(session: Session): SessionInfo {
    return { id: session.id, title: session.title, exited: session.exited, exitCode: session.exitCode }
  }

  private publish(): void {
    this.store.set((s) => ({
      list: [...this.sessions.values()].map((session) => this.info(session)),
      active: s.active && this.sessions.has(s.active) ? s.active : ([...this.sessions.keys()].at(-1) ?? null),
    }))
  }
}

// One Terminal and one Run group per open project, so each project keeps its own sessions
// (including its claude) while another project is shown.
const terminalGroups = new Map<string, SessionGroup>()
const runGroups = new Map<string, SessionGroup>()
const detached = new SessionGroup('none')

function groupFor(groups: Map<string, SessionGroup>, kind: string, root: string | undefined): SessionGroup {
  if (!root) return detached
  let group = groups.get(root)
  if (!group) {
    group = new SessionGroup(kind)
    groups.set(root, group)
  }
  return group
}

export const terminalGroupFor = (root: string | undefined): SessionGroup => groupFor(terminalGroups, 'terminal', root)
export const runGroupFor = (root: string | undefined): SessionGroup => groupFor(runGroups, 'run', root)

/** Groups of the project shown now, for actions that run outside React. */
export const currentTerminalGroup = (): SessionGroup => terminalGroupFor(workbench.get().project?.root)
export const currentRunGroup = (): SessionGroup => runGroupFor(workbench.get().project?.root)

export function useTerminalGroup(): SessionGroup {
  return terminalGroupFor(useStore(workbench, (s) => s.project?.root))
}

export function useRunGroup(): SessionGroup {
  return runGroupFor(useStore(workbench, (s) => s.project?.root))
}

/** Kills every session of a closed project. */
export function closeProjectSessions(root: string): void {
  for (const groups of [terminalGroups, runGroups]) {
    const group = groups.get(root)
    if (!group) continue
    for (const session of group.store.get().list) group.close(session.id)
    groups.delete(root)
  }
}
