// Sits between Monaco's LSP client and one language server. Monaco's client syncs every model and
// initializes without a root, so the router:
// - forwards only file:// documents the server owns (by extension), fixing their languageId;
// - answers requests about other documents locally, so several servers can share one Monaco;
// - adds the project root to `initialize`;
// - restores the real case of document URIs: Monaco's client (0.57) lowercases the URI of
//   didOpen/didChange/didClose but not of requests, so the server would see two documents;
// - lets AnyCode send its own requests (documentSymbol for Structure) on the same connection;
// - can hold location responses until their target files are loaded as models, so peek and
//   cross-file navigation have something to show.
import { lspLanguageId, type LanguageServerSpec } from '@shared/languageServers'

export interface JsonRpcMessage {
  jsonrpc: '2.0'
  id?: number | string | null
  method?: string
  params?: unknown
  result?: unknown
  error?: unknown
}

const SYNC_NOTIFICATIONS = new Set(['textDocument/didChange', 'textDocument/didSave', 'textDocument/willSave'])
/** Responses holding locations in other files. */
const LOCATION_METHODS = new Set([
  'textDocument/definition',
  'textDocument/declaration',
  'textDocument/typeDefinition',
  'textDocument/implementation',
  'textDocument/references',
])
const OWN_ID_PREFIX = 'anycode-'

export function uriToPath(uri: string): string | null {
  if (!uri.startsWith('file://')) return null
  try {
    return decodeURIComponent(new URL(uri).pathname)
  } catch {
    return null
  }
}

export function pathToUri(path: string): string {
  return `file://${path.split('/').map(encodeURIComponent).join('/')}`
}

/** Result for a request answered without the server. */
function emptyResult(method: string): unknown {
  return method === 'textDocument/diagnostic' ? { kind: 'full', items: [] } : null
}

function textDocumentUri(params: unknown): string | undefined {
  const doc = (params as { textDocument?: { uri?: unknown } } | undefined)?.textDocument
  return typeof doc?.uri === 'string' ? doc.uri : undefined
}

function collectUris(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) value.forEach((v) => collectUris(v, into))
  else if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    for (const key of ['uri', 'targetUri']) {
      if (typeof record[key] === 'string') into.add(record[key] as string)
    }
  }
}

export interface RouterOptions {
  spec: LanguageServerSpec
  root: string
  toServer(message: JsonRpcMessage): void
  toClient(message: JsonRpcMessage): void
  /** Called with file paths before a location response reaches the client. */
  ensureLoaded?(paths: string[]): Promise<void>
  /** The model URI (real case) for a lowercased document URI. */
  canonicalUri?(lowercased: string): string | undefined
  /** window/showMessage from the server (also delivered to the client). */
  onShowMessage?(type: number, message: string): void
}

export class LspRouter {
  private readonly accepted = new Set<string>()
  private readonly ownedWaiters = new Map<string, (() => void)[]>()
  private readonly methods = new Map<string | number, string>()
  private readonly own = new Map<string, { resolve(value: unknown): void; reject(error: unknown): void }>()
  private counter = 0
  private initializeId: number | string | null = null
  private markReady: () => void = () => undefined
  /** Resolves once the server answered `initialize` (AnyCode's own requests wait for it). */
  readonly ready = new Promise<void>((resolve) => {
    this.markReady = resolve
  })

  constructor(private readonly options: RouterOptions) {}

  /** True when the server has the document open. */
  owns(uri: string): boolean {
    return this.accepted.has(uri.toLowerCase())
  }

  /** Resolves once the server has the document open (immediately when it already does). */
  whenOwned(uri: string): Promise<void> {
    if (this.owns(uri)) return Promise.resolve()
    return new Promise((resolve) => {
      const key = uri.toLowerCase()
      this.ownedWaiters.set(key, [...(this.ownedWaiters.get(key) ?? []), resolve])
    })
  }

  private canonical(uri: string): string {
    return this.options.canonicalUri?.(uri.toLowerCase()) ?? uri
  }

  private withUri(message: JsonRpcMessage, uri: string): JsonRpcMessage {
    const params = message.params as { textDocument: Record<string, unknown> }
    return { ...message, params: { ...params, textDocument: { ...params.textDocument, uri } } }
  }

  fromClient(message: JsonRpcMessage): void {
    const { method } = message
    if (method === 'initialize') {
      const params = (message.params ?? {}) as Record<string, unknown>
      const rootUri = pathToUri(this.options.root)
      params.rootUri = rootUri
      params.rootPath = this.options.root
      params.workspaceFolders = [{ uri: rootUri, name: this.options.root.split('/').pop() ?? this.options.root }]
      params.clientInfo = { name: 'AnyCode' }
      if (this.options.spec.initializationOptions !== undefined) params.initializationOptions = this.options.spec.initializationOptions
      message = { ...message, params }
      this.initializeId = message.id ?? null
    }
    if (method === 'textDocument/didOpen') {
      const doc = (message.params as { textDocument: { uri: string; languageId: string } }).textDocument
      const uri = this.canonical(doc.uri)
      const path = uriToPath(uri)
      // Each server serves one project root; files of other projects belong to their own server.
      const inRoot = path !== null && (path === this.options.root || path.startsWith(`${this.options.root}/`))
      const languageId = path && inRoot ? lspLanguageId(this.options.spec, path) : null
      if (!languageId) return
      this.accepted.add(uri.toLowerCase())
      this.options.toServer({ ...message, params: { ...(message.params as object), textDocument: { ...doc, uri, languageId } } })
      for (const resolve of this.ownedWaiters.get(uri.toLowerCase()) ?? []) resolve()
      this.ownedWaiters.delete(uri.toLowerCase())
      return
    }
    if (method === 'textDocument/didClose') {
      const uri = textDocumentUri(message.params)
      if (uri && this.accepted.delete(uri.toLowerCase())) this.options.toServer(this.withUri(message, this.canonical(uri)))
      return
    }
    if (method && SYNC_NOTIFICATIONS.has(method)) {
      const uri = textDocumentUri(message.params)
      if (uri && this.owns(uri)) this.options.toServer(this.withUri(message, this.canonical(uri)))
      return
    }
    const isRequest = message.id !== undefined && message.id !== null && method !== undefined
    if (isRequest) {
      const uri = textDocumentUri(message.params)
      if (uri !== undefined && !this.owns(uri)) {
        this.options.toClient({ jsonrpc: '2.0', id: message.id, result: emptyResult(method) })
        return
      }
      this.methods.set(message.id!, method)
    }
    this.options.toServer(message)
  }

  fromServer(message: JsonRpcMessage): void {
    if (message.method === 'client/registerCapability') message = this.scopeRegistrations(message)
    if (message.method === 'workspace/configuration' && message.id !== undefined && message.id !== null) {
      // Monaco's client has no handler; answer "no settings" for each requested section.
      const items = (message.params as { items?: unknown[] } | undefined)?.items ?? []
      this.options.toServer({ jsonrpc: '2.0', id: message.id, result: items.map(() => null) })
      return
    }
    if (message.method === 'window/showMessage') {
      const { type, message: text } = message.params as { type: number; message: string }
      this.options.onShowMessage?.(type, text)
    }
    const isResponse = message.method === undefined && message.id !== undefined && message.id !== null
    if (isResponse && message.id === this.initializeId) this.markReady()
    if (isResponse && typeof message.id === 'string' && message.id.startsWith(OWN_ID_PREFIX)) {
      const pending = this.own.get(message.id)
      this.own.delete(message.id)
      if (message.error) pending?.reject(message.error)
      else pending?.resolve(message.result)
      return
    }
    if (isResponse) {
      const method = this.methods.get(message.id!)
      this.methods.delete(message.id!)
      if (method && LOCATION_METHODS.has(method) && this.options.ensureLoaded) {
        const uris = new Set<string>()
        collectUris(message.result, uris)
        const paths = [...uris].flatMap((uri) => uriToPath(uri) ?? [])
        void this.options
          .ensureLoaded(paths)
          .catch(() => undefined)
          .then(() => this.options.toClient(message))
        return
      }
    }
    this.options.toClient(message)
  }

  /**
   * Dynamic registrations without registerOptions (jdtls sends many) make Monaco's client throw;
   * registrations without a documentSelector would apply to every language. Scope both to the
   * server's languages.
   */
  private scopeRegistrations(message: JsonRpcMessage): JsonRpcMessage {
    const params = message.params as { registrations?: { method: string; registerOptions?: Record<string, unknown> | null }[] }
    if (!params?.registrations) return message
    const documentSelector = [...new Set(Object.values(this.options.spec.languageIdByExtension))].map((language) => ({
      language: this.options.spec.monacoLanguages.includes(language) ? language : this.options.spec.monacoLanguages[0]!,
      scheme: 'file',
    }))
    const unique = documentSelector.filter((s, i) => documentSelector.findIndex((o) => o.language === s.language) === i)
    return {
      ...message,
      params: {
        ...params,
        registrations: params.registrations.map((registration) =>
          registration.method.startsWith('textDocument/')
            ? { ...registration, registerOptions: { documentSelector: unique, ...(registration.registerOptions ?? {}) } }
            : registration,
        ),
      },
    }
  }

  /** AnyCode's own request on the same connection; never reaches Monaco's client. */
  async request<T>(method: string, params: unknown): Promise<T> {
    await this.ready
    const id = `${OWN_ID_PREFIX}${++this.counter}`
    return await new Promise<T>((resolve, reject) => {
      this.own.set(id, { resolve: (value) => resolve(value as T), reject })
      this.options.toServer({ jsonrpc: '2.0', id, method, params })
    })
  }
}
