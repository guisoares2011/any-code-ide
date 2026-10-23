import { useEffect, useMemo, useRef, useState } from 'react'
import * as monaco from 'monaco-editor'
import { requestReveal } from '../editor/documents'
import { LANGUAGE_SERVERS } from '@shared/languageServers'
import { languageServerState, routerFor } from '../lsp/client'
import { useStore } from '../state/store'
import { openFile, workbench } from '../state/workbench'
import { Icon } from '../ui/Icon'
import { useListNavigation } from '../ui/useListNavigation'

interface LspRange {
  start: { line: number; character: number }
  end: { line: number; character: number }
}

/** LSP DocumentSymbol (hierarchical) or SymbolInformation (flat) — both are valid responses. */
interface LspSymbol {
  name: string
  detail?: string
  kind: number
  range?: LspRange
  selectionRange?: LspRange
  location?: { uri: string; range: LspRange }
  children?: LspSymbol[]
}

interface Row {
  symbol: LspSymbol
  depth: number
}

// LSP SymbolKind -> expui node icon.
const KIND_ICONS: Record<number, string> = {
  5: 'nodes/class',
  10: 'nodes/enum',
  11: 'nodes/interface',
  23: 'nodes/class',
  6: 'nodes/method',
  9: 'nodes/method',
  12: 'nodes/function',
  7: 'nodes/field',
  8: 'nodes/field',
  13: 'nodes/variable',
  14: 'nodes/variable',
  22: 'nodes/field',
}

const REFRESH_DELAY_MS = 400

function flatten(symbols: readonly LspSymbol[], depth = 0, into: Row[] = []): Row[] {
  const sorted = [...symbols].sort((a, b) => (a.range ?? a.location?.range)!.start.line - (b.range ?? b.location?.range)!.start.line)
  for (const symbol of sorted) {
    into.push({ symbol, depth })
    if (symbol.children) flatten(symbol.children, depth + 1, into)
  }
  return into
}

/** Symbols of the active file, from the language server (textDocument/documentSymbol). */
export function StructureView({ visible }: { visible: boolean }) {
  const activeTab = useStore(workbench, (s) => s.tabs.find((t) => t.path === s.activeTab && t.kind === 'file')?.path ?? null)
  const servers = useStore(languageServerState, (s) => s)
  const [symbols, setSymbols] = useState<{ path: string; list: LspSymbol[] } | null>(null)
  const [selected, setSelected] = useState(0)
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!activeTab || !visible) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const load = async (): Promise<void> => {
      const model = monaco.editor.getModel(monaco.Uri.file(activeTab))
      const router = await routerFor(activeTab)
      if (!model || !router) return
      const uri = model.uri.toString(true)
      // The server may still be starting; ask once it has the document.
      await router.whenOwned(uri)
      if (cancelled) return
      const list = await router.request<LspSymbol[] | null>('textDocument/documentSymbol', { textDocument: { uri } })
      if (!cancelled) setSymbols({ path: activeTab, list: list ?? [] })
    }
    void load()
    const model = monaco.editor.getModel(monaco.Uri.file(activeTab))
    const subscription = model?.onDidChangeContent(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void load(), REFRESH_DELAY_MS)
    })
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      subscription?.dispose()
    }
  }, [activeTab, visible, servers])

  const rows = useMemo(() => (symbols && symbols.path === activeTab ? flatten(symbols.list) : []), [symbols, activeTab])

  const activate = (row: Row): void => {
    if (!activeTab) return
    const range = row.symbol.selectionRange ?? row.symbol.range ?? row.symbol.location?.range
    if (range) {
      requestReveal(activeTab, {
        startLineNumber: range.start.line + 1,
        startColumn: range.start.character + 1,
        endLineNumber: range.end.line + 1,
        endColumn: range.end.character + 1,
      })
    }
    openFile(activeTab)
  }
  useListNavigation(container, rows, selected, setSelected, activate)

  if (!activeTab) return <div className="empty-state">Open a file to see its structure.</div>
  if (rows.length === 0) {
    const model = monaco.editor.getModel(monaco.Uri.file(activeTab))
    const spec = LANGUAGE_SERVERS.find((s) => model && s.monacoLanguages.includes(model.getLanguageId()))
    const state = spec ? servers[spec.id] : undefined
    return (
      <div className="empty-state">
        {!spec
          ? 'No language server for this file.'
          : state === 'running'
            ? symbols?.path === activeTab
              ? 'No symbols'
              : 'Loading symbols…'
            : state === 'unavailable'
              ? `${spec.name} is not installed.`
              : `Starting ${spec.name}…`}
      </div>
    )
  }
  return (
    <div className="tree" tabIndex={0} ref={container} data-focus-area="tree" role="tree" aria-label="Structure">
      {rows.map((row, index) => (
        <div
          key={index}
          role="treeitem"
          aria-selected={index === selected}
          className={`tree-row${index === selected ? ' selected' : ''}`}
          style={{ paddingLeft: 8 + row.depth * 18 }}
          onMouseDown={() => setSelected(index)}
          onDoubleClick={() => activate(row)}
        >
          <Icon name={KIND_ICONS[row.symbol.kind] ?? 'nodes/variable'} />
          <span>{row.symbol.name}</span>
          {row.symbol.detail && <span className="hint">{row.symbol.detail}</span>}
        </div>
      ))}
    </div>
  )
}
