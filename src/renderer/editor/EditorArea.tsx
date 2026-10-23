import { useEffect, useRef, useState } from 'react'
import type { editor } from 'monaco-editor'
import { DiffHost } from '../bridge/DiffHost'
import { rejectDiffByKey } from '../bridge/diffs'
import { trackSelection } from '../bridge/selection'
import { useActions, shortcutFor } from '../keymap/service'
import { closeTab, showTabProject, workbench, type EditorTab } from '../state/workbench'
import { gitState } from '../state/git'
import { useStore } from '../state/store'
import { VcsDiffHost } from '../vcs/VcsDiffHost'
import { isMarkdownFile, LAYOUT_ACTIONS, layoutOf, markdownLayouts, setMarkdownLayout } from '../markdown/layout'
import { MarkdownPreview } from '../markdown/MarkdownPreview'
import { Icon } from '../ui/Icon'
import { fileIconName } from '../ui/icons'
import { applyPendingReveal, openDocument, releaseDocument, revealRequests, type DocumentState } from './documents'
import { editorActions, sendSelectionToClaude } from './editorActions'
import { setupMonaco, THEME_NAME } from './monacoSetup'
import { editorFont, settingsState } from '../state/settings'

/** Closing a Claude diff tab rejects the proposal; closing a file tab releases its document. */
export function closeEditorTab(tab: EditorTab): void {
  if (tab.kind === 'diff') {
    if (!rejectDiffByKey(tab.path)) closeTab(tab.path)
    return
  }
  closeTab(tab.path)
  void releaseDocument(tab.path)
}

export function EditorArea() {
  const tabs = useStore(workbench, (s) => s.tabs)
  const activeTab = useStore(workbench, (s) => s.activeTab)
  const dirty = useStore(workbench, (s) => s.dirty)
  const vcs = useStore(gitState, (s) => s.byPath)
  const active = tabs.find((t) => t.path === activeTab)

  return (
    <div className="island editor-island" data-focus-area="editor">
      {tabs.length > 0 && (
        <div className="editor-tabs" role="tablist">
          {tabs.map((tab) => (
            <div
              key={tab.path}
              role="tab"
              aria-selected={tab.path === activeTab}
              className={`editor-tab${tab.path === activeTab ? ' selected' : ''}${dirty.has(tab.path) ? ' dirty' : ''}${tab.kind === 'diff' ? ' diff' : ''}`}
              title={tab.kind === 'diff' ? 'Change proposed by Claude' : (tab.filePath ?? tab.path)}
              onMouseDown={(event) => {
                if (event.button === 1) closeEditorTab(tab)
                else {
                  workbench.set({ activeTab: tab.path })
                  // Also when the tab was already active: its project becomes the current one.
                  showTabProject(tab.path)
                }
              }}
            >
              <Icon name={tab.kind === 'file' ? fileIconName(tab.name) : 'vcs/diff'} />
              <span className={`tab-name${tab.kind === 'file' && vcs.get(tab.path) ? ` vcs-${vcs.get(tab.path)!.kind}` : ''}`}>{tab.name}</span>
              <button
                className="icon-button small tab-close"
                title={`Close Tab (${shortcutFor('CloseContent') ?? ''})`}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={() => closeEditorTab(tab)}
              >
                <Icon name="general/closeSmall" size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="editor-host">
        {active?.kind === 'diff' ? (
          <DiffHost tabKey={active.path} />
        ) : active?.kind === 'vcs-diff' ? (
          <VcsDiffHost key={active.path} path={active.filePath!} revision={active.revision} originalPath={active.originalPath} />
        ) : active ? (
          <FileEditor path={active.path} />
        ) : (
          <EditorPlaceholder />
        )}
      </div>
    </div>
  )
}

/**
 * A file editor; Markdown files add a rendered preview beside or instead of the text, switched like
 * IntelliJ's TextEditorWithPreview. The Monaco host keeps its place in the tree, so switching tabs
 * never recreates the editor.
 */
function FileEditor({ path }: { path: string }) {
  const markdown = isMarkdownFile(path)
  const defaultLayout = useStore(settingsState, (s) => s.settings.markdown.defaultLayout)
  const layout = useStore(markdownLayouts, (s) => layoutOf(path, s.byPath, defaultLayout))
  const effective = markdown ? layout : 'editor'

  useActions(
    () =>
      LAYOUT_ACTIONS.map((action) => ({
        id: action.id,
        text: action.text,
        isEnabled: () => {
          const active = workbench.get().activeTab
          return active !== null && isMarkdownFile(active)
        },
        perform: () => {
          const active = workbench.get().activeTab
          if (active) setMarkdownLayout(active, action.layout)
        },
      })),
    [],
  )

  return (
    <div className={`editor-panes layout-${effective}`}>
      <div className="editor-pane">
        <MonacoHost path={path} />
      </div>
      {effective !== 'editor' && (
        <div className="preview-pane">
          <MarkdownPreview path={path} />
        </div>
      )}
      {markdown && (
        <div className="preview-layout-toolbar" role="toolbar" aria-label="Markdown layout">
          {LAYOUT_ACTIONS.map((action) => (
            <button
              key={action.id}
              className={`icon-button${layout === action.layout ? ' selected' : ''}`}
              title={action.text}
              aria-label={action.text}
              aria-pressed={layout === action.layout}
              onClick={() => setMarkdownLayout(path, action.layout)}
            >
              <Icon name={action.icon} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const PLACEHOLDER_ACTIONS: readonly [label: string, actionId: string][] = [
  ['Search Everywhere', 'SearchEverywhere'],
  ['Go to File', 'GotoFile'],
  ['Recent Files', 'RecentFiles'],
  ['Find Action', 'GotoAction'],
  ['Terminal', 'ActivateTerminalToolWindow'],
]

function EditorPlaceholder() {
  return (
    <div className="editor-placeholder">
      <div className="shortcut-row">
        {PLACEHOLDER_ACTIONS.map(([label, actionId]) => (
          <PlaceholderRow key={actionId} label={label} keys={shortcutFor(actionId) ?? ''} />
        ))}
      </div>
    </div>
  )
}

function PlaceholderRow({ label, keys }: { label: string; keys: string }) {
  return (
    <>
      <span className="label">{label}</span>
      <span className="keys">{keys}</span>
    </>
  )
}

function MonacoHost({ path }: { path: string }) {
  const container = useRef<HTMLDivElement>(null)
  const instance = useRef<editor.IStandaloneCodeEditor | null>(null)
  const viewStates = useRef(new Map<string, editor.ICodeEditorViewState | null>())
  const [loaded, setLoaded] = useState<{ path: string; document: DocumentState } | null>(null)
  const state = loaded?.path === path ? loaded.document : null
  const focus = useStore(workbench, (s) => s.focus)
  const reveal = useStore(revealRequests, (s) => s.seq)

  useActions(() => [...editorActions(() => instance.current), sendSelectionToClaude(() => instance.current)], [])

  // One editor instance for the lifetime of the editor area.
  useEffect(() => {
    const monaco = setupMonaco()
    if (!container.current) return
    const created = monaco.editor.create(container.current, {
      theme: THEME_NAME,
      model: null,
      automaticLayout: true,
      fontFamily: 'JetBrains Mono',
      ...editorFont(),
      fontLigatures: false,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderLineHighlight: 'all',
      guides: { indentation: true },
      padding: { top: 6 },
      smoothScrolling: true,
      stickyScroll: { enabled: true },
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
    })
    instance.current = created
    const caret = created.onDidChangeCursorPosition((event) =>
      workbench.set({ caret: { line: event.position.lineNumber, column: event.position.column } }),
    )
    const selection = created.onDidChangeCursorSelection(() => trackSelection(created))
    return () => {
      caret.dispose()
      selection.dispose()
      created.dispose()
      instance.current = null
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void openDocument(path).then((document) => {
      if (cancelled) return
      setLoaded({ path, document })
      const editorInstance = instance.current
      if (!editorInstance) return
      const previous = editorInstance.getModel()
      if (previous) viewStates.current.set(previous.uri.fsPath, editorInstance.saveViewState())
      if (document.kind === 'text') {
        editorInstance.setModel(document.model)
        const viewState = viewStates.current.get(path)
        if (viewState) editorInstance.restoreViewState(viewState)
        applyPendingReveal(path, editorInstance)
        trackSelection(editorInstance)
        const position = editorInstance.getPosition()
        workbench.set({ caret: position ? { line: position.lineNumber, column: position.column } : null })
        if (workbench.get().focus.target === 'editor') editorInstance.focus()
      } else editorInstance.setModel(null)
    })
    return () => {
      cancelled = true
    }
  }, [path])

  useEffect(() => {
    if (focus.target === 'editor') instance.current?.focus()
  }, [focus])

  // openFile from Claude on the file already shown: apply its selection now.
  useEffect(() => {
    const editorInstance = instance.current
    if (editorInstance && editorInstance.getModel()?.uri.fsPath === path) applyPendingReveal(path, editorInstance)
  }, [reveal, path])

  return (
    <>
      <div ref={container} style={{ position: 'absolute', inset: 0, visibility: state?.kind === 'text' ? 'visible' : 'hidden' }} />
      {state && state.kind !== 'text' && (
        <div className="empty-state">
          {state.kind === 'error' ? state.message : `This file is ${state.kind === 'binary' ? 'binary' : 'too large'} (${state.size} bytes).`}
        </div>
      )}
    </>
  )
}
