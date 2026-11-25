import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { editor } from 'monaco-editor'
import { basename, relativePath } from '@shared/paths'
import type { SearchMatch, SearchResult } from '@shared/textSearch'
import { requestReveal, loadedModel } from '../editor/documents'
import { languageForFile, setupMonaco, THEME_NAME } from '../editor/monacoSetup'
import { shortcutFor, useActions } from '../keymap/service'
import { editorFont } from '../state/settings'
import { useStore } from '../state/store'
import { openFile, requestFocus, workbench } from '../state/workbench'
import { askConfirm } from '../ui/dialogs'
import { Icon } from '../ui/Icon'
import { fileIconName } from '../ui/icons'
import {
  closeFindInFiles,
  effectiveOptions,
  findState,
  replaceAllInFiles,
  replaceOne,
  searchInFiles,
  type FindMode,
  type FindPopupState,
} from './findInFiles'

const SEARCH_DELAY_MS = 200

interface Row {
  key: string
  path: string
  match: SearchMatch
}

export function FindInFilesHost() {
  const mode = useStore(findState, (s) => s.mode)
  return mode ? <FindInFilesPopup mode={mode} /> : null
}

const update = (patch: Partial<FindPopupState> | ((s: FindPopupState) => Partial<FindPopupState>)): void => findState.set(patch)
const setOption = <K extends keyof FindPopupState['options']>(key: K, value: FindPopupState['options'][K]): void =>
  update((s) => ({ options: { ...s.options, [key]: value } }))

function FindInFilesPopup({ mode }: { mode: FindMode }) {
  const project = useStore(workbench, (s) => s.project)
  const state = useStore(findState, (s) => s)
  const { options, scope, directory, maskEnabled } = state
  /** The last finished search, with the inputs it answered. */
  const [done, setDone] = useState<{ key: string; result: SearchResult } | null>(null)
  const [selected, setSelected] = useState(0)
  /** Bumped after a replacement so the results are searched again. */
  const [generation, setGeneration] = useState(0)
  const queryInput = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const root = project?.root ?? ''

  const searched = useMemo(() => effectiveOptions(state), [state])
  const searchDirectory = scope === 'directory' && directory && directory !== root ? directory : undefined
  const searchKey = JSON.stringify([root, searchDirectory, searched.query, searched.caseSensitive, searched.wholeWords, searched.regex, searched.fileMask, generation])
  const active = root !== '' && searched.query !== ''
  // While a new search runs, the previous results stay (IntelliJ keeps them too).
  const result = active ? (done?.result ?? null) : null
  const searching = active && done?.key !== searchKey
  useEffect(() => {
    if (!active) return
    const timer = setTimeout(() => {
      void searchInFiles(root, searchDirectory, searched).then((next) => {
        if (!next) return
        setDone({ key: searchKey, result: next })
        setSelected((s) => Math.min(s, Math.max(0, next.total - 1)))
      })
    }, SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [searchKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo<Row[]>(
    () => (result?.files ?? []).flatMap((file) => file.matches.map((match) => ({ key: `${file.path}:${match.line}:${match.column}`, path: file.path, match }))),
    [result],
  )
  const current = rows[selected]

  useEffect(() => {
    listRef.current?.querySelector('.find-row.selected')?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const latest = useRef({ rows, selected, result, state })
  useLayoutEffect(() => {
    latest.current = { rows, selected, result, state }
  })

  const close = (): void => {
    closeFindInFiles()
    requestFocus(workbench.get().focus.target)
  }

  const openRow = (row: Row | undefined): void => {
    if (!row) return
    closeFindInFiles()
    requestReveal(row.path, { startLineNumber: row.match.line, startColumn: row.match.column, endLineNumber: row.match.endLine, endColumn: row.match.endColumn })
    openFile(row.path)
  }

  const replaceSelected = async (): Promise<void> => {
    const { rows: list, selected: index, state: s } = latest.current
    const row = list[index]
    if (!row) return
    await replaceOne(row.path, row.match, effectiveOptions(s), s.replacement)
    setGeneration((g) => g + 1)
    queryInput.current?.focus()
  }

  const replaceEverything = async (): Promise<void> => {
    const { result: r, state: s } = latest.current
    if (!r || r.total === 0) return
    const answer = await askConfirm({
      title: 'Replace All',
      message: `Replace ${r.total}${r.truncated ? '+' : ''} occurrences of '${s.options.query}' with '${s.replacement}' in ${r.files.length}${r.truncated ? '+' : ''} files?`,
      confirmLabel: 'Replace',
    })
    if (!answer) {
      queryInput.current?.focus()
      return
    }
    await replaceAllInFiles(r.files, effectiveOptions(s), s.replacement)
    setSelected(0)
    setGeneration((g) => g + 1)
    queryInput.current?.focus()
  }

  useActions(() => {
    const inPopup = (c: { focusArea: string }) => c.focusArea === 'popup'
    const move = (delta: number) => () =>
      setSelected((s) => {
        const count = latest.current.rows.length
        return count === 0 ? 0 : (s + delta + count) % count
      })
    const toggle = (key: 'caseSensitive' | 'wholeWords' | 'regex') => () => setOption(key, !findState.get().options[key])
    return [
      { id: 'List-selectNextRow', isEnabled: inPopup, perform: move(1) },
      { id: 'List-selectPreviousRow', isEnabled: inPopup, perform: move(-1) },
      { id: 'Popup.Confirm', isEnabled: inPopup, perform: () => openRow(latest.current.rows[latest.current.selected]) },
      { id: 'Popup.Cancel', isEnabled: inPopup, perform: close },
      { id: 'EditorSearchSession.ToggleMatchCase', isEnabled: inPopup, perform: toggle('caseSensitive') },
      { id: 'EditorSearchSession.ToggleWholeWordsOnlyAction', isEnabled: inPopup, perform: toggle('wholeWords') },
      { id: 'EditorSearchSession.ToggleRegex', isEnabled: inPopup, perform: toggle('regex') },
    ]
  }, [])

  // ⇧⌘F with the popup open in replace mode (or ⇧⌘R in find mode) switches it, keeping the query.
  useEffect(() => {
    queryInput.current?.focus()
    queryInput.current?.select()
  }, [mode])

  const files = result?.files.length ?? 0
  const plus = result?.truncated ? '+' : ''
  const summary = result?.error
    ? result.error
    : result
      ? result.total === 0
        ? 'No matches'
        : `${result.total}${plus} ${result.total === 1 ? 'match' : 'matches'} in ${files}${plus} ${files === 1 ? 'file' : 'files'}`
      : ''

  const toggleButton = (key: 'caseSensitive' | 'wholeWords' | 'regex', label: string, title: string, actionId: string) => (
    <button
      className={`find-toggle${options[key] ? ' selected' : ''}`}
      title={`${title} (${shortcutFor(actionId) ?? ''})`}
      aria-pressed={options[key]}
      onClick={() => {
        setOption(key, !options[key])
        queryInput.current?.focus()
      }}
    >
      {label}
    </button>
  )

  return (
    <div className="popup-backdrop" onMouseDown={close}>
      <div
        className="popup find-popup"
        data-focus-area="popup"
        role="dialog"
        aria-label={mode === 'replace' ? 'Replace in Files' : 'Find in Files'}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="find-header">
          <span className="find-title">{mode === 'replace' ? 'Replace in Files' : 'Find in Files'}</span>
          <span className={`find-summary${result?.error ? ' error' : ''}`}>{searching ? 'Searching…' : summary}</span>
          <label className="checkbox-field find-mask">
            <input type="checkbox" checked={maskEnabled} onChange={(e) => update({ maskEnabled: e.target.checked })} />
            File mask:
            <input
              className="text-field"
              placeholder="*.ts, !*.test.ts"
              spellCheck={false}
              value={options.fileMask}
              onChange={(e) => {
                setOption('fileMask', e.target.value)
                update({ maskEnabled: e.target.value.trim() !== '' })
              }}
            />
          </label>
        </div>
        <div className="find-scopes">
          {(['project', 'directory'] as const).map((s) => (
            <button key={s} className={`popup-tab${scope === s ? ' selected' : ''}`} onClick={() => update({ scope: s })}>
              {s === 'project' ? 'In Project' : 'Directory'}
            </button>
          ))}
          {scope === 'directory' && (
            <input className="text-field find-directory" spellCheck={false} value={directory} onChange={(e) => update({ directory: e.target.value.replace(/\/+$/, '') })} />
          )}
        </div>
        <div className="popup-search find-field">
          <Icon name="general/search" />
          <input
            ref={queryInput}
            aria-label="Search text"
            value={options.query}
            placeholder="Text to find"
            spellCheck={false}
            onChange={(e) => {
              setOption('query', e.target.value)
              setSelected(0)
            }}
          />
          {toggleButton('caseSensitive', 'Cc', 'Match Case', 'EditorSearchSession.ToggleMatchCase')}
          {toggleButton('wholeWords', 'W', 'Words', 'EditorSearchSession.ToggleWholeWordsOnlyAction')}
          {toggleButton('regex', '.*', 'Regex', 'EditorSearchSession.ToggleRegex')}
        </div>
        {mode === 'replace' && (
          <div className="popup-search find-field">
            <Icon name="general/edit" />
            <input aria-label="Replacement" value={state.replacement} placeholder="Replace with" spellCheck={false} onChange={(e) => update({ replacement: e.target.value })} />
          </div>
        )}
        <div className="find-results" ref={listRef} role="listbox">
          {rows.map((row, index) => (
            <div
              key={row.key}
              role="option"
              aria-selected={index === selected}
              className={`find-row${index === selected ? ' selected' : ''}`}
              onMouseDown={() => setSelected(index)}
              onDoubleClick={() => openRow(row)}
            >
              <span className="find-row-text">
                {row.match.preview.slice(0, row.match.previewStart)}
                <mark>{row.match.preview.slice(row.match.previewStart, row.match.previewEnd)}</mark>
                {row.match.preview.slice(row.match.previewEnd)}
              </span>
              <span className="find-row-file" title={relativePath(root, row.path)}>
                <Icon name={fileIconName(basename(row.path))} size={14} />
                {basename(row.path)} <span className="find-row-line">{row.match.line}</span>
              </span>
            </div>
          ))}
        </div>
        <ResultPreview row={current} rows={rows} root={root} />
        <div className="find-footer">
          <span>{current ? relativePath(root, current.path) : ''}</span>
          <span className="find-footer-actions">
            {mode === 'replace' ? (
              <>
                <button className="button secondary" disabled={!current} onClick={() => void replaceSelected()}>
                  Replace
                </button>
                <button className="button primary" disabled={!result?.total} onClick={() => void replaceEverything()}>
                  Replace All
                </button>
              </>
            ) : (
              <button className="button secondary" disabled={!current} onClick={() => openRow(current)}>
                Open in Editor
              </button>
            )}
          </span>
        </div>
      </div>
    </div>
  )
}

/** The file of the selected result, read-only, with its matches marked, like the bottom of IntelliJ's popup. */
function ResultPreview({ row, rows, root }: { row: Row | undefined; rows: readonly Row[]; root: string }) {
  const host = useRef<HTMLDivElement>(null)
  const instance = useRef<editor.IStandaloneCodeEditor | null>(null)
  const preview = useRef<{ path: string; model: editor.ITextModel; owned: boolean } | null>(null)
  const decorations = useRef<editor.IEditorDecorationsCollection | null>(null)

  useEffect(() => {
    const monaco = setupMonaco()
    if (!host.current) return
    const created = monaco.editor.create(host.current, {
      theme: THEME_NAME,
      model: null,
      readOnly: true,
      domReadOnly: true,
      automaticLayout: true,
      fontFamily: 'JetBrains Mono',
      ...editorFont(),
      fontLigatures: false,
      minimap: { enabled: false },
      lineNumbers: 'on',
      glyphMargin: false,
      folding: false,
      scrollBeyondLastLine: false,
      renderLineHighlight: 'none',
      contextmenu: false,
      stickyScroll: { enabled: false },
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
    })
    instance.current = created
    decorations.current = created.createDecorationsCollection()
    return () => {
      created.dispose()
      if (preview.current?.owned) preview.current.model.dispose()
      preview.current = null
    }
  }, [])

  const path = row?.path
  useEffect(() => {
    let cancelled = false
    const show = async (): Promise<void> => {
      const view = instance.current
      if (!view || !row || !path) return
      if (preview.current?.path !== path) {
        // An open document shows its unsaved text; other files get a throwaway model outside file://,
        // so language servers never see it.
        const monaco = setupMonaco()
        let model = loadedModel(path)
        let owned = false
        if (!model) {
          const content = await window.anycode.invoke('fs:readFile', path)
          if (cancelled || content.kind !== 'text') return
          model = monaco.editor.createModel(content.content, languageForFile(basename(path)), monaco.Uri.from({ scheme: 'anycode-preview', path }))
          owned = true
        }
        if (preview.current?.owned) preview.current.model.dispose()
        preview.current = { path, model, owned }
        view.setModel(model)
      }
      const ranges = rows
        .filter((r) => r.path === path)
        .map((r) => ({
          range: { startLineNumber: r.match.line, startColumn: r.match.column, endLineNumber: r.match.endLine, endColumn: r.match.endColumn },
          options: { inlineClassName: r === row ? 'currentFindMatch' : 'findMatch' },
        }))
      decorations.current?.set(ranges)
      view.revealLineInCenter(row.match.line)
    }
    void show()
    return () => {
      cancelled = true
    }
  }, [row, rows, path, root])

  return <div className="find-preview" ref={host} style={{ visibility: row ? 'visible' : 'hidden' }} />
}
