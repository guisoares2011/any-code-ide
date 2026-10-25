// Language servers in the renderer: Monaco's built-in LSP client (monaco.lsp.MonacoLspClient) over
// IPC to the server process the main process runs, with LspRouter in between. A server starts
// lazily, when the first document it owns is opened.
import * as monaco from 'monaco-editor'
import { LANGUAGE_SERVERS, type LanguageServerId, type LanguageServerSpec } from '@shared/languageServers'
import { openDocument } from '../editor/documents'
import { notify } from '../state/notifications'
import { projectRootOf } from '../state/projects'
import { createStore } from '../state/store'
import { LspRouter, uriToPath, type JsonRpcMessage } from './router'

type Transport = ConstructorParameters<typeof monaco.lsp.MonacoLspClient>[0]
type TransportMessage = Parameters<Transport['send']>[0]
type ConnectionState = Transport['state']['value']

export type ServerState = 'starting' | 'running' | 'unavailable' | 'exited'

export const languageServerState = createStore<Partial<Record<LanguageServerId, ServerState>>>({})

/** Location responses load at most this many target files as models before showing them. */
const MAX_PRELOADED_FILES = 50

class IpcTransport implements Transport {
  private listener: ((message: TransportMessage) => void) | undefined
  private readonly queue: TransportMessage[] = []
  readonly state = {
    value: { state: 'open' } as ConnectionState,
    onChange: () => ({ dispose: () => undefined }),
  }

  constructor(private readonly outgoing: (message: JsonRpcMessage) => void) {}

  send(message: TransportMessage): Promise<void> {
    this.outgoing(message as JsonRpcMessage)
    return Promise.resolve()
  }

  setListener(listener: ((message: TransportMessage) => void) | undefined): void {
    this.listener = listener
    if (listener) for (const message of this.queue.splice(0)) listener(message)
  }

  deliver(message: JsonRpcMessage): void {
    if (this.listener) this.listener(message as TransportMessage)
    else this.queue.push(message as TransportMessage)
  }

  toString(): string {
    return 'anycode-ipc'
  }
}

interface RunningServer {
  spec: LanguageServerSpec
  router: LspRouter
}

/** Running servers per `${server id}:${project root}`. */
const servers = new Map<string, Promise<RunningServer | null>>()

/** Turns off Monaco's own TypeScript service features once the language server takes over. */
function disableBuiltInTypeScript(): void {
  const off = {
    completionItems: false,
    hovers: false,
    documentSymbols: false,
    definitions: false,
    references: false,
    documentHighlights: false,
    rename: false,
    diagnostics: false,
    documentRangeFormattingEdits: false,
    signatureHelp: false,
    onTypeFormattingEdits: false,
    codeActions: false,
    inlayHints: false,
  }
  monaco.typescript.typescriptDefaults.setModeConfiguration(off)
  monaco.typescript.javascriptDefaults.setModeConfiguration(off)
}

async function start(spec: LanguageServerSpec, root: string): Promise<RunningServer | null> {
  languageServerState.set({ [spec.id]: 'starting' })
  const sessionId = await window.anycode.invoke('lsp:start', spec.id, root)
  if (!sessionId) {
    languageServerState.set({ [spec.id]: 'unavailable' })
    notify(
      'warning',
      `${spec.name} is not available`,
      spec.id === 'typescript'
        ? 'The bundled typescript-go binary could not start.'
        : 'Install it with: node scripts/install-language-servers.mjs',
    )
    return null
  }
  let transport: IpcTransport | null = null
  const router = new LspRouter({
    spec,
    root,
    toServer: (message) => window.anycode.send('lsp:send', sessionId, message),
    toClient: (message) => transport?.deliver(message),
    // LSP MessageType: 1 error, 2 warning, 3 info, 4 log.
    onShowMessage: (type, message) => {
      if (type <= 3) notify(type === 1 ? 'error' : type === 2 ? 'warning' : 'info', spec.name, message)
    },
    canonicalUri: (lowercased) =>
      monaco.editor
        .getModels()
        .find((m) => m.uri.toString(true).toLowerCase() === lowercased)
        ?.uri.toString(true),
    ensureLoaded: async (paths) => {
      await Promise.all(paths.slice(0, MAX_PRELOADED_FILES).map((path) => openDocument(path)))
    },
  })
  transport = new IpcTransport((message) => router.fromClient(message))
  window.anycode.on('lsp:message', (id, message) => {
    if (id === sessionId) router.fromServer(message as JsonRpcMessage)
  })
  window.anycode.on('lsp:exit', (id) => {
    if (id !== sessionId) return
    languageServerState.set({ [spec.id]: 'exited' })
    notify('error', spec.name, 'The language server stopped. It restarts when a file it handles is opened again.')
    servers.delete(spec.id)
  })
  if (spec.id === 'typescript') disableBuiltInTypeScript()
  new monaco.lsp.MonacoLspClient(transport)
  languageServerState.set({ [spec.id]: 'running' })
  return { spec, router }
}

function ensureServer(spec: LanguageServerSpec, root: string): Promise<RunningServer | null> {
  const key = `${spec.id}:${root}`
  let server = servers.get(key)
  if (!server) {
    server = start(spec, root)
    servers.set(key, server)
  }
  return server
}

/** The running server that owns a file, for AnyCode's own requests (document symbols...). */
export async function routerFor(path: string): Promise<LspRouter | null> {
  const model = monaco.editor.getModel(monaco.Uri.file(path))
  const spec = LANGUAGE_SERVERS.find((s) => model && s.monacoLanguages.includes(model.getLanguageId()))
  const root = projectRootOf(path)
  if (!spec || !root) return null
  return (await ensureServer(spec, root))?.router ?? null
}

/** The server of a language for a project root, started if needed (the debugger asks jdtls for java-debug). */
export async function languageServerRouter(id: LanguageServerId, root: string): Promise<LspRouter | null> {
  const spec = LANGUAGE_SERVERS.find((s) => s.id === id)
  return spec ? ((await ensureServer(spec, root))?.router ?? null) : null
}

let installed = false

/** Starts servers as documents they own appear, and routes cross-file navigation to tabs. */
export function installLanguageServers(): void {
  if (installed) return
  installed = true
  const consider = (model: monaco.editor.ITextModel): void => {
    if (model.uri.scheme !== 'file') return
    const spec = LANGUAGE_SERVERS.find((s) => s.monacoLanguages.includes(model.getLanguageId()))
    const root = projectRootOf(model.uri.fsPath)
    if (spec && root) void ensureServer(spec, root)
  }
  monaco.editor.onDidCreateModel(consider)
  monaco.editor.getModels().forEach(consider)
}

/** Document URI → absolute path, for components that receive LSP URIs. */
export { uriToPath }
