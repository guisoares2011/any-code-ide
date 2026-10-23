import { describe, expect, it } from 'vitest'
import { LANGUAGE_SERVERS } from '@shared/languageServers'
import { LspRouter, pathToUri, uriToPath, type JsonRpcMessage } from './router'

function setup(ensureLoaded?: (paths: string[]) => Promise<void>) {
  const server: JsonRpcMessage[] = []
  const client: JsonRpcMessage[] = []
  const router = new LspRouter({
    spec: LANGUAGE_SERVERS.find((s) => s.id === 'typescript')!,
    root: '/p/app',
    toServer: (m) => server.push(m),
    toClient: (m) => client.push(m),
    ensureLoaded,
  })
  return { router, server, client }
}

const open = (uri: string, languageId = 'typescript'): JsonRpcMessage => ({
  jsonrpc: '2.0',
  method: 'textDocument/didOpen',
  params: { textDocument: { uri, languageId, version: 1, text: '' } },
})

describe('LspRouter', () => {
  it('adds the project root to initialize', () => {
    const { router, server } = setup()
    router.fromClient({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: null, capabilities: {} } })
    expect(server[0]?.params).toMatchObject({ rootUri: 'file:///p/app', workspaceFolders: [{ uri: 'file:///p/app', name: 'app' }] })
  })

  it('keeps jdtls from writing Eclipse metadata into the project', () => {
    const server: JsonRpcMessage[] = []
    const router = new LspRouter({ spec: LANGUAGE_SERVERS.find((s) => s.id === 'java')!, root: '/p/app', toServer: (m) => server.push(m), toClient: () => {} })
    router.fromClient({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: null, capabilities: {} } })
    expect(server[0]?.params).toMatchObject({ initializationOptions: { settings: { java: { import: { generatesMetadataFilesAtProjectRoot: false } } } } })
  })

  it('forwards only owned file documents and fixes the languageId', () => {
    const { router, server } = setup()
    router.fromClient(open('file:///p/app/a.tsx'))
    router.fromClient(open('file:///p/app/readme.md', 'markdown'))
    router.fromClient(open('anycode-diff://1/proposed'))
    expect(server).toHaveLength(1)
    expect(server[0]?.params).toMatchObject({ textDocument: { uri: 'file:///p/app/a.tsx', languageId: 'typescriptreact' } })
    router.fromClient({ jsonrpc: '2.0', method: 'textDocument/didChange', params: { textDocument: { uri: 'file:///p/app/readme.md' } } })
    router.fromClient({ jsonrpc: '2.0', method: 'textDocument/didChange', params: { textDocument: { uri: 'file:///p/app/a.tsx' } } })
    expect(server.map((m) => m.method)).toEqual(['textDocument/didOpen', 'textDocument/didChange'])
  })

  it('restores the case Monaco lowercases in sync notifications', () => {
    const server: JsonRpcMessage[] = []
    const router = new LspRouter({
      spec: LANGUAGE_SERVERS[0]!,
      root: '/p/App',
      toServer: (m) => server.push(m),
      toClient: () => undefined,
      canonicalUri: (lower) => (lower === 'file:///p/app/src/a.ts' ? 'file:///p/App/src/A.ts' : undefined),
    })
    router.fromClient(open('file:///p/app/src/a.ts'))
    router.fromClient({ jsonrpc: '2.0', method: 'textDocument/didChange', params: { textDocument: { uri: 'file:///p/app/src/a.ts' } } })
    router.fromClient({ jsonrpc: '2.0', id: 1, method: 'textDocument/hover', params: { textDocument: { uri: 'file:///p/App/src/A.ts' } } })
    expect(server.map((m) => (m.params as { textDocument: { uri: string } }).textDocument.uri)).toEqual([
      'file:///p/App/src/A.ts',
      'file:///p/App/src/A.ts',
      'file:///p/App/src/A.ts',
    ])
    expect(router.owns('file:///p/App/src/A.ts')).toBe(true)
  })

  it('waits for a document to be opened on the server', async () => {
    const { router } = setup()
    let opened = false
    const waiting = router.whenOwned('file:///p/app/late.ts').then(() => (opened = true))
    await Promise.resolve()
    expect(opened).toBe(false)
    router.fromClient(open('file:///p/app/late.ts'))
    await waiting
    expect(opened).toBe(true)
  })

  it('answers requests about foreign documents locally', () => {
    const { router, server, client } = setup()
    router.fromClient({ jsonrpc: '2.0', id: 7, method: 'textDocument/hover', params: { textDocument: { uri: 'file:///p/app/x.java' } } })
    router.fromClient({ jsonrpc: '2.0', id: 8, method: 'textDocument/diagnostic', params: { textDocument: { uri: 'file:///p/app/x.java' } } })
    expect(server).toHaveLength(0)
    expect(client).toEqual([
      { jsonrpc: '2.0', id: 7, result: null },
      { jsonrpc: '2.0', id: 8, result: { kind: 'full', items: [] } },
    ])
  })

  it('loads target files before delivering location responses', async () => {
    const loaded: string[][] = []
    const { router, client } = setup(async (paths) => {
      loaded.push(paths)
    })
    router.fromClient(open('file:///p/app/a.ts'))
    router.fromClient({ jsonrpc: '2.0', id: 3, method: 'textDocument/definition', params: { textDocument: { uri: 'file:///p/app/a.ts' } } })
    router.fromServer({ jsonrpc: '2.0', id: 3, result: [{ uri: 'file:///p/app/b.ts', range: {} }] })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(loaded).toEqual([['/p/app/b.ts']])
    expect(client.at(-1)).toMatchObject({ id: 3 })
  })

  it('keeps its own requests away from the client', async () => {
    const { router, server, client } = setup()
    const symbols = router.request<string[]>('textDocument/documentSymbol', {})
    const id = server[0]!.id
    router.fromServer({ jsonrpc: '2.0', id, result: ['s'] })
    expect(await symbols).toEqual(['s'])
    expect(client).toHaveLength(0)
  })

  it('scopes dynamic registrations to the server languages', () => {
    const { router, client } = setup()
    router.fromServer({
      jsonrpc: '2.0',
      id: 9,
      method: 'client/registerCapability',
      params: { registrations: [{ id: 'a', method: 'textDocument/hover' }, { id: 'b', method: 'workspace/didChangeConfiguration' }] },
    })
    const registrations = (client[0]!.params as { registrations: { registerOptions?: { documentSelector: unknown[] } }[] }).registrations
    expect(registrations[0]!.registerOptions!.documentSelector).toEqual([
      { language: 'typescript', scheme: 'file' },
      { language: 'javascript', scheme: 'file' },
    ])
    expect(registrations[1]!.registerOptions).toBeUndefined()
  })

  it('answers workspace/configuration itself and reports showMessage', () => {
    const shown: string[] = []
    const server: JsonRpcMessage[] = []
    const client: JsonRpcMessage[] = []
    const router = new LspRouter({
      spec: LANGUAGE_SERVERS[0]!,
      root: '/p',
      toServer: (m) => server.push(m),
      toClient: (m) => client.push(m),
      onShowMessage: (_type, text) => shown.push(text),
    })
    router.fromServer({ jsonrpc: '2.0', id: 5, method: 'workspace/configuration', params: { items: [{ section: 'a' }, { section: 'b' }] } })
    expect(server).toEqual([{ jsonrpc: '2.0', id: 5, result: [null, null] }])
    router.fromServer({ jsonrpc: '2.0', method: 'window/showMessage', params: { type: 3, message: 'import skipped' } })
    expect(shown).toEqual(['import skipped'])
    expect(client.map((m) => m.method)).toEqual(['window/showMessage'])
  })

  it('converts paths and URIs', () => {
    expect(pathToUri('/p/my app/a.ts')).toBe('file:///p/my%20app/a.ts')
    expect(uriToPath('file:///p/my%20app/a.ts')).toBe('/p/my app/a.ts')
    expect(uriToPath('inmemory://1')).toBeNull()
  })
})
