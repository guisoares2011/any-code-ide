// A Debug Adapter Protocol client over one connection the main process holds (debug:connect).
// Requests resolve with the response body; adapters' reverse requests (runInTerminal,
// startDebugging) go to registered handlers.

export interface DapMessage {
  seq: number
  type: 'request' | 'response' | 'event'
  command?: string
  event?: string
  request_seq?: number
  success?: boolean
  message?: string
  arguments?: unknown
  body?: unknown
}

type EventListener = (body: unknown) => void
type ReverseHandler = (args: unknown) => unknown

const clients = new Map<string, DapClient>()
let listening = false

function listen(): void {
  if (listening) return
  listening = true
  window.anycode.on('debug:message', (id, message) => clients.get(id)?.receive(message as DapMessage))
  window.anycode.on('debug:closed', (id) => clients.get(id)?.closedByAdapter())
}

export class DapClient {
  private seq = 0
  private readonly pending = new Map<number, { command: string; resolve(body: unknown): void; reject(error: Error): void }>()
  private readonly listeners = new Map<string, Set<EventListener>>()
  private readonly reverse = new Map<string, ReverseHandler>()
  private readonly closeListeners = new Set<() => void>()
  closed = false

  private constructor(readonly id: string) {}

  static async connect(port: number): Promise<DapClient> {
    listen()
    const id = await window.anycode.invoke('debug:connect', port)
    const client = new DapClient(id)
    clients.set(id, client)
    return client
  }

  request<T = unknown>(command: string, args?: unknown): Promise<T> {
    if (this.closed) return Promise.reject(new Error('The debug session ended'))
    const seq = ++this.seq
    return new Promise<T>((resolve, reject) => {
      this.pending.set(seq, { command, resolve: (body) => resolve(body as T), reject })
      window.anycode.send('debug:send', this.id, { seq, type: 'request', command, ...(args === undefined ? {} : { arguments: args }) })
    })
  }

  on(event: string, listener: EventListener): () => void {
    const set = this.listeners.get(event) ?? new Set()
    set.add(listener)
    this.listeners.set(event, set)
    return () => set.delete(listener)
  }

  /** Handles a request the adapter sends to the client. */
  handle(command: string, handler: ReverseHandler): void {
    this.reverse.set(command, handler)
  }

  onClose(listener: () => void): void {
    if (this.closed) listener()
    else this.closeListeners.add(listener)
  }

  receive(message: DapMessage): void {
    if (message.type === 'response') {
      const pending = this.pending.get(message.request_seq ?? -1)
      if (!pending) return
      this.pending.delete(message.request_seq!)
      if (message.success) pending.resolve(message.body)
      else pending.reject(new Error(message.message || `${pending.command} failed`))
    } else if (message.type === 'event' && message.event) {
      for (const listener of this.listeners.get(message.event) ?? []) listener(message.body)
    } else if (message.type === 'request' && message.command) {
      void this.answer(message)
    }
  }

  private async answer(message: DapMessage): Promise<void> {
    const handler = this.reverse.get(message.command!)
    const respond = (success: boolean, body?: unknown, error?: string): void =>
      window.anycode.send('debug:send', this.id, {
        seq: ++this.seq,
        type: 'response',
        request_seq: message.seq,
        command: message.command,
        success,
        ...(body === undefined ? {} : { body }),
        ...(error ? { message: error } : {}),
      })
    if (!handler) {
      respond(false, undefined, `${message.command} is not supported`)
      return
    }
    try {
      respond(true, (await handler(message.arguments)) ?? {})
    } catch (error) {
      respond(false, undefined, error instanceof Error ? error.message : String(error))
    }
  }

  closedByAdapter(): void {
    if (this.closed) return
    this.closed = true
    clients.delete(this.id)
    for (const pending of this.pending.values()) pending.reject(new Error('The debug session ended'))
    this.pending.clear()
    for (const listener of this.closeListeners) listener()
    this.closeListeners.clear()
  }

  dispose(): void {
    if (!this.closed) void window.anycode.invoke('debug:disconnect', this.id)
    this.closedByAdapter()
  }
}

// The parts of DAP's types AnyCode reads.

export interface DapCapabilities {
  supportsConfigurationDoneRequest?: boolean
  supportsConditionalBreakpoints?: boolean
  supportsTerminateRequest?: boolean
  supportsEvaluateForHovers?: boolean
}

export interface DapSource {
  name?: string
  path?: string
  sourceReference?: number
}

export interface DapThread {
  id: number
  name: string
}

export interface DapStackFrame {
  id: number
  name: string
  source?: DapSource
  line: number
  column: number
  presentationHint?: 'normal' | 'label' | 'subtle'
}

export interface DapScope {
  name: string
  variablesReference: number
  expensive?: boolean
}

export interface DapVariable {
  name: string
  value: string
  type?: string
  variablesReference: number
}

export interface DapStoppedEvent {
  reason: string
  description?: string
  threadId?: number
  allThreadsStopped?: boolean
  text?: string
}

export interface DapBreakpoint {
  verified: boolean
  line?: number
  message?: string
}
