// One debug session as the Debug tool window shows it: the adapter connections (js-debug opens a
// child connection per Node process), the program's state, its threads and frames, and the
// console terminal of the debugged process.
import { createStore } from '../state/store'
import { notify } from '../state/notifications'
import { allBreakpoints, breakpointsOf, breakpointState, markVerified, onBreakpointsChanged } from './breakpoints'
import type { DapBreakpoint, DapCapabilities, DapClient, DapScope, DapStackFrame, DapStoppedEvent, DapThread, DapVariable } from './dap'

export type DebugKind = 'java' | 'node'
export type DebugStatus = 'starting' | 'running' | 'paused' | 'terminated'

export interface DebugSessionState {
  status: DebugStatus
  /** What the session waits for, or why it ended badly ("Building…", "Cannot attach: …"). */
  message: string | null
  threads: DapThread[]
  /** Thread whose frames are shown. */
  threadId: number | null
  /** Why the program stopped ("breakpoint", "step"...). */
  reason: string | null
  frames: DapStackFrame[]
  frameId: number | null
  /** Frames failed to load (e.g. the selected thread is running). */
  framesError: string | null
}

/** Source files each adapter can set breakpoints in. */
const BREAKPOINT_FILES: Record<DebugKind, RegExp> = {
  java: /\.java$/,
  node: /\.(m|c)?(j|t)sx?$/,
}

let counter = 0

export class DebugSession {
  readonly id = `debug-${++counter}`
  readonly store = createStore<DebugSessionState>({
    status: 'starting',
    message: null,
    threads: [],
    threadId: null,
    reason: null,
    frames: [],
    frameId: null,
    framesError: null,
  })
  /** The console terminal (debug group of ptySessions) of the debugged process. */
  consoleId: string | null = null
  private readonly clients: DapClient[] = []
  private readonly capabilities = new Map<DapClient, DapCapabilities>()
  /** The connection whose program is paused (js-debug: the child of the Node process that stopped). */
  private stoppedClient: DapClient | null = null
  /** Run to Cursor: a one-off breakpoint removed at the next stop. */
  private temporary: { path: string; line: number } | null = null
  private readonly unsubscribe: () => void
  private readonly endListeners = new Set<() => void>()

  constructor(
    readonly name: string,
    readonly kind: DebugKind,
    readonly root: string,
    /** Starts the same session again (Rerun). */
    readonly restart: () => void,
  ) {
    this.unsubscribe = onBreakpointsChanged((path) => {
      for (const client of this.clients) void this.sendBreakpoints(client, path)
    })
  }

  get state(): DebugSessionState {
    return this.store.get()
  }

  setMessage(message: string | null): void {
    this.store.set({ message })
  }

  onEnd(listener: () => void): void {
    if (this.state.status === 'terminated') listener()
    else this.endListeners.add(listener)
  }

  /** Follows the events of a connection; `main` connections end the session when they close. */
  addClient(client: DapClient, main: boolean): void {
    this.clients.push(client)
    client.on('stopped', (body) => void this.stopped(client, body as DapStoppedEvent))
    client.on('continued', () => {
      if (this.stoppedClient === client) this.running()
    })
    client.on('thread', () => {
      if (this.state.status === 'paused') void this.loadThreads(client)
    })
    client.on('output', (body) => {
      const { category, output } = body as { category?: string; output?: string }
      // The process writes to its console terminal; "important" messages are the adapter's own.
      if (category === 'important' && output) notify('warning', this.name, output.trim())
    })
    const finished = (): void => {
      const index = this.clients.indexOf(client)
      if (index >= 0) this.clients.splice(index, 1)
      if (this.stoppedClient === client) this.running()
      if (main) this.terminate()
    }
    client.on('terminated', finished)
    client.onClose(finished)
  }

  /** initialize, with the client capabilities AnyCode supports. */
  async initialize(client: DapClient, adapterID: string, extra: Record<string, unknown> = {}): Promise<void> {
    const capabilities = await client.request<DapCapabilities>('initialize', {
      clientID: 'anycode',
      clientName: 'AnyCode',
      adapterID,
      pathFormat: 'path',
      linesStartAt1: true,
      columnsStartAt1: true,
      supportsVariableType: true,
      locale: 'en',
      ...extra,
    })
    this.capabilities.set(client, capabilities ?? {})
  }

  /** After the adapter's `initialized` event: breakpoints, then configurationDone. */
  async configure(client: DapClient): Promise<void> {
    const paths = [...new Set(allBreakpoints().map((b) => b.path))].filter((p) => BREAKPOINT_FILES[this.kind].test(p))
    await Promise.all(paths.map((path) => this.sendBreakpoints(client, path)))
    await client.request('setExceptionBreakpoints', { filters: [] }).catch(() => undefined)
    if (this.capabilities.get(client)?.supportsConfigurationDoneRequest !== false) await client.request('configurationDone').catch(() => undefined)
    if (this.state.status === 'starting') this.store.set({ status: 'running', message: null })
  }

  private async sendBreakpoints(client: DapClient, path: string): Promise<void> {
    if (!BREAKPOINT_FILES[this.kind].test(path) || client.closed) return
    const muted = breakpointState.get().muted
    const lines = muted ? [] : breakpointsOf(path).filter((b) => b.enabled).map((b) => b.line)
    if (this.temporary?.path === path && !lines.includes(this.temporary.line)) lines.push(this.temporary.line)
    const name = path.slice(path.lastIndexOf('/') + 1)
    try {
      const result = await client.request<{ breakpoints?: DapBreakpoint[] }>('setBreakpoints', {
        source: { name, path },
        breakpoints: lines.map((line) => ({ line })),
        lines,
        sourceModified: false,
      })
      if (!muted) markVerified(path, (result?.breakpoints ?? []).map((b) => b.verified))
    } catch {
      // The adapter refused the file (not part of its program); leave the breakpoints unverified.
    }
  }

  private async stopped(client: DapClient, event: DapStoppedEvent): Promise<void> {
    this.stoppedClient = client
    if (this.temporary) {
      const { path } = this.temporary
      this.temporary = null
      void this.sendBreakpoints(client, path)
    }
    this.store.set({ status: 'paused', reason: event.description ?? event.reason, threadId: event.threadId ?? this.state.threadId })
    await this.loadThreads(client)
    await this.loadFrames(this.state.threadId)
  }

  private async loadThreads(client: DapClient): Promise<void> {
    try {
      const { threads } = await client.request<{ threads: DapThread[] }>('threads')
      const threadId = this.state.threadId ?? threads[0]?.id ?? null
      this.store.set({ threads, threadId })
    } catch {
      // keep what is shown
    }
  }

  /** Frames of a thread; the first one with a source becomes the selected frame. */
  async loadFrames(threadId: number | null): Promise<void> {
    const client = this.stoppedClient
    if (!client || threadId === null) return
    this.store.set({ threadId })
    try {
      const { stackFrames } = await client.request<{ stackFrames: DapStackFrame[] }>('stackTrace', { threadId, startFrame: 0, levels: 100 })
      const top = stackFrames.find((f) => f.source?.path && f.presentationHint !== 'subtle') ?? stackFrames[0]
      this.store.set({ frames: stackFrames, frameId: top?.id ?? null, framesError: null })
    } catch (error) {
      this.store.set({ frames: [], frameId: null, framesError: error instanceof Error ? error.message : String(error) })
    }
  }

  selectFrame(frameId: number): void {
    this.store.set({ frameId })
  }

  selectedFrame(): DapStackFrame | undefined {
    return this.state.frames.find((f) => f.id === this.state.frameId)
  }

  private running(): void {
    this.stoppedClient = null
    this.store.set({ status: 'running', reason: null, frames: [], frameId: null, framesError: null })
  }

  private step(command: string): void {
    const client = this.stoppedClient
    const threadId = this.state.threadId
    if (!client || threadId === null) return
    this.running()
    void client.request(command, { threadId }).catch((error: Error) => notify('error', this.name, error.message))
  }

  resume(): void {
    this.step('continue')
  }

  stepOver(): void {
    this.step('next')
  }

  stepInto(): void {
    this.step('stepIn')
  }

  stepOut(): void {
    this.step('stepOut')
  }

  /** Run to Cursor: continue with a one-off breakpoint at the line. */
  runToCursor(path: string, line: number): void {
    const client = this.stoppedClient
    if (!client) return
    this.temporary = { path, line }
    void this.sendBreakpoints(client, path).then(() => this.resume())
  }

  pause(): void {
    for (const client of this.clients) {
      void client.request('pause', { threadId: this.state.threadId ?? this.state.threads[0]?.id ?? 1 }).catch(() => undefined)
    }
  }

  get paused(): boolean {
    return this.state.status === 'paused' && this.stoppedClient !== null
  }

  get active(): boolean {
    return this.state.status !== 'terminated'
  }

  async scopes(frameId: number): Promise<DapScope[]> {
    const client = this.stoppedClient
    if (!client) return []
    const { scopes } = await client.request<{ scopes: DapScope[] }>('scopes', { frameId })
    return scopes
  }

  async variables(variablesReference: number): Promise<DapVariable[]> {
    const client = this.stoppedClient
    if (!client) return []
    const { variables } = await client.request<{ variables: DapVariable[] }>('variables', { variablesReference })
    return variables
  }

  /** Evaluates in the selected frame (Evaluate Expression, editor hovers). */
  async evaluate(expression: string, context: 'repl' | 'hover' | 'watch'): Promise<DapVariable> {
    const client = this.stoppedClient
    if (!client) throw new Error('The program is not paused')
    const result = await client.request<{ result: string; type?: string; variablesReference: number }>('evaluate', {
      expression,
      frameId: this.state.frameId ?? undefined,
      context,
    })
    return { name: expression, value: result.result, variablesReference: result.variablesReference, ...(result.type ? { type: result.type } : {}) }
  }

  /** Stop: ends the program (the console's process too, through the caller). */
  async stop(): Promise<void> {
    await Promise.all(
      this.clients.map((client) =>
        Promise.race([
          client.request('disconnect', { terminateDebuggee: true, restart: false }).catch(() => undefined),
          new Promise((resolve) => setTimeout(resolve, 1500)),
        ]),
      ),
    )
    this.terminate()
  }

  fail(message: string): void {
    this.store.set({ message })
    this.terminate()
  }

  terminate(): void {
    if (this.state.status === 'terminated') return
    this.stoppedClient = null
    this.store.set({ status: 'terminated', frames: [], frameId: null, threads: [], reason: null })
    for (const client of [...this.clients]) client.dispose()
    this.clients.length = 0
    this.unsubscribe()
    for (const listener of this.endListeners) listener()
    this.endListeners.clear()
  }
}
