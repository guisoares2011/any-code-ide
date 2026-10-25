import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { LANGUAGE_SERVERS, type LanguageServerId } from '@shared/languageServers'
import { FONT_SIZE_RANGE, LINE_HEIGHT_RANGE, type MarkdownDefaultLayout, type Settings } from '@shared/settings'
import { actionLabel, actions, activeKeymap, useActions } from '../keymap/service'
import { shortcutLabel, formatShortcut } from '../keymap/shortcut'
import { notify } from '../state/notifications'
import { saveSettings, settingsState } from '../state/settings'
import { createStore, useStore } from '../state/store'

/** The open Settings dialog and its page, or null when closed. */
const settingsDialog = createStore<{ page: PageId | null }>({ page: null })

export function openSettings(page: PageId = 'editor.font'): void {
  settingsDialog.set({ page })
}

const closeSettings = (): void => settingsDialog.set({ page: null })

type PageId = 'keymap' | 'editor.font' | 'tools.terminal' | 'languages.servers' | 'languages.eslint' | 'languages.markdown'

interface PageProps {
  draft: Settings
  update(change: (draft: Settings) => Settings): void
}

interface Page {
  id: PageId
  /** Breadcrumb, as in IntelliJ's Settings tree. */
  path: readonly string[]
  /** Words the search matches besides the path (field labels). */
  keywords: string
  render(props: PageProps): ReactNode
}

const PAGES: readonly Page[] = [
  { id: 'keymap', path: ['Keymap'], keywords: 'shortcut keyboard action', render: () => <KeymapPage /> },
  { id: 'editor.font', path: ['Editor', 'Font'], keywords: 'size line height', render: (p) => <FontPage {...p} /> },
  { id: 'tools.terminal', path: ['Tools', 'Terminal'], keywords: 'shell path agent claude command font size', render: (p) => <TerminalPage {...p} /> },
  { id: 'languages.servers', path: ['Languages & Frameworks', 'Language Servers'], keywords: 'lsp typescript java kotlin jdtls', render: () => <LanguageServersPage /> },
  { id: 'languages.eslint', path: ['Languages & Frameworks', 'ESLint'], keywords: 'lint javascript code quality', render: (p) => <EslintPage {...p} /> },
  { id: 'languages.markdown', path: ['Languages & Frameworks', 'Markdown'], keywords: 'preview layout readme', render: (p) => <MarkdownPage {...p} /> },
]

/** Hosts ShowSettings (⌘,) and IntelliJ's Settings dialog. */
export function SettingsDialog() {
  const page = useStore(settingsDialog, (s) => s.page)
  useActions(() => [{ id: 'ShowSettings', isEnabled: (c) => c.focusArea !== 'dialog', perform: () => openSettings() }], [])
  return page ? <Dialog initialPage={page} /> : null
}

function Dialog({ initialPage }: { initialPage: PageId }) {
  const saved = useStore(settingsState, (s) => s.settings)
  const [draft, setDraft] = useState(saved)
  const [pageId, setPageId] = useState(initialPage)
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => searchRef.current?.focus(), [])

  const visiblePages = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    return PAGES.filter((p) => words.every((w) => `${p.path.join(' ')} ${p.keywords}`.toLowerCase().includes(w)))
  }, [query])
  const page = visiblePages.find((p) => p.id === pageId) ?? visiblePages[0]
  const modified = JSON.stringify(draft) !== JSON.stringify(saved)

  const apply = async (): Promise<boolean> => {
    if (!modified) return true
    try {
      await saveSettings(draft)
      setDraft(settingsState.get().settings)
      return true
    } catch (error) {
      notify('error', 'Cannot save settings', error instanceof Error ? error.message : String(error))
      return false
    }
  }
  const ok = async (): Promise<void> => {
    if (await apply()) closeSettings()
  }

  const state = useRef({ ok })
  useEffect(() => {
    state.current = { ok }
  })
  useActions(
    () => [
      { id: 'Popup.Cancel', isEnabled: (c) => c.focusArea === 'dialog', perform: closeSettings },
      { id: 'Popup.Confirm', isEnabled: (c) => c.focusArea === 'dialog', perform: () => void state.current.ok() },
    ],
    [],
  )

  // Group pages under their first path segment, like the Settings tree.
  const groups = new Map<string, Page[]>()
  for (const p of visiblePages) groups.set(p.path[0]!, [...(groups.get(p.path[0]!) ?? []), p])

  return (
    <div className="popup-backdrop" onMouseDown={closeSettings}>
      <div className="dialog settings-dialog" role="dialog" aria-label="Settings" data-focus-area="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="settings-body">
          <div className="settings-nav">
            <input
              ref={searchRef}
              className="text-field"
              placeholder="Search settings"
              aria-label="Search settings"
              spellCheck={false}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="tree" role="tree" aria-label="Settings pages">
              {[...groups].map(([group, pages]) =>
                pages.length === 1 && pages[0]!.path.length === 1 ? (
                  <NavRow key={group} page={pages[0]!} label={group} depth={0} selected={pages[0] === page} onSelect={setPageId} />
                ) : (
                  <div key={group}>
                    <div className="tree-row settings-group">{group}</div>
                    {pages.map((p) => (
                      <NavRow key={p.id} page={p} label={p.path.at(-1)!} depth={1} selected={p === page} onSelect={setPageId} />
                    ))}
                  </div>
                ),
              )}
            </div>
          </div>
          <div className="settings-page">
            {page ? (
              <>
                <div className="settings-breadcrumb">{page.path.join(' › ')}</div>
                {page.render({ draft, update: (change) => setDraft((d) => change(d)) })}
              </>
            ) : (
              <div className="empty-state">Nothing matches “{query}”</div>
            )}
          </div>
        </div>
        <div className="dialog-footer">
          <span className="toolbar-spacer" />
          <button className="button secondary" onClick={closeSettings}>
            Cancel
          </button>
          <button className="button secondary" disabled={!modified} onClick={() => void apply()}>
            Apply
          </button>
          <button className="button primary" onClick={() => void ok()}>
            OK
          </button>
        </div>
      </div>
    </div>
  )
}

function NavRow({ page, label, depth, selected, onSelect }: { page: Page; label: string; depth: number; selected: boolean; onSelect(id: PageId): void }) {
  return (
    <div
      role="treeitem"
      aria-selected={selected}
      className={`tree-row${selected ? ' selected' : ''}`}
      style={{ paddingLeft: 8 + depth * 16 }}
      onMouseDown={() => onSelect(page.id)}
    >
      {label}
    </div>
  )
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="form-field">
      <span className="form-label">{label}</span>
      <span className="settings-control">
        {children}
        {hint && <span className="hint">{hint}</span>}
      </span>
    </label>
  )
}

function NumberField({ label, value, range, onChange }: { label: string; value: number; range: { min: number; max: number }; onChange(value: number): void }) {
  return (
    <Field label={label}>
      <input
        className="text-field settings-number"
        type="number"
        min={range.min}
        max={range.max}
        value={value}
        onChange={(e) => {
          const next = Number(e.target.value)
          if (Number.isFinite(next)) onChange(Math.min(Math.max(Math.round(next), range.min), range.max))
        }}
      />
    </Field>
  )
}

function FontPage({ draft, update }: PageProps) {
  return (
    <div className="form">
      <NumberField label="Size" value={draft.editor.fontSize} range={FONT_SIZE_RANGE} onChange={(fontSize) => update((d) => ({ ...d, editor: { ...d.editor, fontSize } }))} />
      <NumberField label="Line height (px)" value={draft.editor.lineHeight} range={LINE_HEIGHT_RANGE} onChange={(lineHeight) => update((d) => ({ ...d, editor: { ...d.editor, lineHeight } }))} />
      <div className="form-note">JetBrains Mono, like IntelliJ. Applies to editors and diffs.</div>
    </div>
  )
}

function TerminalPage({ draft, update }: PageProps) {
  const terminal = (patch: Partial<Settings['terminal']>) => update((d) => ({ ...d, terminal: { ...d.terminal, ...patch } }))
  return (
    <div className="form">
      <Field label="Shell path" hint="Empty uses $SHELL. Applies to new terminals and runs.">
        <input className="text-field" placeholder="$SHELL" spellCheck={false} value={draft.terminal.shell} onChange={(e) => terminal({ shell: e.target.value })} />
      </Field>
      <Field label="Agent command" hint="Opened in each project's first terminal tab. Empty opens a shell.">
        <input className="text-field" placeholder="claude" spellCheck={false} value={draft.terminal.agentCommand} onChange={(e) => terminal({ agentCommand: e.target.value })} />
      </Field>
      <NumberField label="Font size" value={draft.terminal.fontSize} range={FONT_SIZE_RANGE} onChange={(fontSize) => terminal({ fontSize })} />
    </div>
  )
}

function EslintPage({ draft, update }: PageProps) {
  return (
    <div className="form">
      <label className="checkbox-field">
        <input type="checkbox" checked={draft.eslint.enabled} onChange={(e) => update((d) => ({ ...d, eslint: { enabled: e.target.checked } }))} />
        Automatic ESLint configuration
      </label>
      <div className="hint">
        Lints JavaScript and TypeScript with the project's own ESLint (node_modules/eslint and its configuration), in a separate process. Projects without ESLint are left alone.
      </div>
    </div>
  )
}

const MARKDOWN_LAYOUTS: readonly { value: MarkdownDefaultLayout; label: string }[] = [
  { value: 'auto', label: 'Preview for READMEs, editor and preview otherwise' },
  { value: 'editor', label: 'Editor only' },
  { value: 'split', label: 'Editor and preview' },
  { value: 'preview', label: 'Preview only' },
]

function MarkdownPage({ draft, update }: PageProps) {
  return (
    <div className="form">
      <Field label="Default layout">
        <select
          className="text-field"
          value={draft.markdown.defaultLayout}
          onChange={(e) => update((d) => ({ ...d, markdown: { defaultLayout: e.target.value as MarkdownDefaultLayout } }))}
        >
          {MARKDOWN_LAYOUTS.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>
      </Field>
    </div>
  )
}

const INSTALL_HINT: Partial<Record<LanguageServerId, string>> = {
  java: 'node scripts/install-language-servers.mjs jdtls',
  kotlin: 'node scripts/install-language-servers.mjs kotlin',
}

function LanguageServersPage() {
  const [locations, setLocations] = useState<Record<LanguageServerId, string | null> | null>(null)
  const [adapters, setAdapters] = useState<{ java: string | null; node: string | null } | null>(null)
  useEffect(() => {
    void window.anycode.invoke('lsp:locations').then(setLocations)
    void window.anycode.invoke('debug:adapters').then(setAdapters)
  }, [])
  const debugAdapters = [
    { id: 'java', name: 'Java debugger (java-debug)', location: adapters?.java, install: 'java-debug' },
    { id: 'node', name: 'Node.js debugger (js-debug)', location: adapters?.node, install: 'js-debug' },
  ]
  return (
    <div className="settings-table" role="table" aria-label="Language servers">
      {LANGUAGE_SERVERS.map((server) => {
        const location = locations?.[server.id]
        return (
          <div key={server.id} className="settings-table-row" role="row">
            <span role="cell">{server.name}</span>
            <span role="cell" className={location ? 'hint' : 'vcs-conflicted'}>
              {locations === null ? '…' : location ? `Installed: ${location}` : `Not installed. Run: ${INSTALL_HINT[server.id] ?? ''}`}
            </span>
          </div>
        )
      })}
      {debugAdapters.map((adapter) => (
        <div key={adapter.id} className="settings-table-row" role="row">
          <span role="cell">{adapter.name}</span>
          <span role="cell" className={adapter.location ? 'hint' : 'vcs-conflicted'}>
            {adapters === null
              ? '…'
              : adapter.location
                ? `Installed: ${adapter.location}`
                : `Not installed. Run: node scripts/install-language-servers.mjs ${adapter.install}`}
          </span>
        </div>
      ))}
      <div className="hint">Servers start when a file of their language opens; debuggers when a debug session starts.</div>
    </div>
  )
}

const MAX_KEYMAP_ROWS = 300

/** Read-only view of the effective macOS keymap; searchable by name, action id or shortcut. */
function KeymapPage() {
  const [query, setQuery] = useState('')
  const [onlyAvailable, setOnlyAvailable] = useState(true)
  const rows = useMemo(() => {
    const keymap = activeKeymap()
    const registered = new Set(actions.all().map((a) => a.id))
    const ids = new Set([...keymap.actionIds(), ...registered])
    return [...ids]
      .map((id) => {
        const shortcuts = keymap.getShortcuts(id)
        return {
          id,
          name: actionLabel(actions.get(id) ?? { id }),
          labels: shortcuts.map(shortcutLabel),
          // "meta shift O" etc., so a typed shortcut description matches too.
          raw: shortcuts.map(formatShortcut).join(' '),
          available: registered.has(id),
        }
      })
      .filter((row) => row.labels.length > 0 || row.available)
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [])
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const matches = rows.filter(
    (row) => (!onlyAvailable || row.available) && words.every((w) => `${row.name} ${row.id} ${row.labels.join(' ')} ${row.raw}`.toLowerCase().includes(w)),
  )
  return (
    <div className="keymap-page">
      <div className="keymap-filters">
        <input
          className="text-field"
          placeholder="Search actions or shortcuts (⌘K, meta K…)"
          aria-label="Search keymap"
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className="checkbox-field">
          <input type="checkbox" checked={onlyAvailable} onChange={(e) => setOnlyAvailable(e.target.checked)} />
          Only actions AnyCode implements
        </label>
      </div>
      <div className="hint">macOS keymap from IntelliJ (Mac OS X 10.5+), read-only.</div>
      <div className="settings-table keymap-table" role="table" aria-label="Keymap">
        {matches.slice(0, MAX_KEYMAP_ROWS).map((row) => (
          <div key={row.id} className="settings-table-row" role="row" title={row.id}>
            <span role="cell">{row.name}</span>
            <span role="cell" className="keymap-shortcuts">
              {row.labels.map((label) => (
                <kbd key={label}>{label}</kbd>
              ))}
            </span>
          </div>
        ))}
        {matches.length > MAX_KEYMAP_ROWS && <div className="hint">{matches.length - MAX_KEYMAP_ROWS} more; refine the search.</div>}
        {matches.length === 0 && <div className="hint">No actions match.</div>}
      </div>
    </div>
  )
}
