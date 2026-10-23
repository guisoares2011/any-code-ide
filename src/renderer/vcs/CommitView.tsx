import { useEffect, useMemo, useRef, useState } from 'react'
import type { GitFileStatus } from '@shared/git'
import { basename, dirname } from '@shared/paths'
import { shortcutFor, useActions } from '../keymap/service'
import { commitFiles, gitState, refreshGit } from '../state/git'
import { useStore } from '../state/store'
import { openVcsDiffTab, workbench } from '../state/workbench'
import { Icon } from '../ui/Icon'
import { fileIconName } from '../ui/icons'
import { useListNavigation } from '../ui/useListNavigation'
import { changesSelection, openRollback } from './rollback'

type Row = { kind: 'group'; title: string; files: GitFileStatus[] } | { kind: 'file'; file: GitFileStatus }

/**
 * IntelliJ's Commit tool window: tracked changes and unversioned files with checkboxes (tracked
 * ones included by default), a message and Commit / Commit and Push.
 */
/** Commit tool window toolbar: Refresh and Rollback. */
export function CommitHeaderActions() {
  const status = useStore(gitState, (s) => s.status)
  return (
    <>
      <button className="icon-button" title="Refresh" aria-label="Refresh" onClick={() => void refreshGit()}>
        <Icon name="general/refresh" />
      </button>
      <button
        className="icon-button"
        title={`Rollback…${shortcutLabel('ChangesView.Revert')}`}
        aria-label="Rollback…"
        disabled={!status.files.some((f) => f.kind !== 'untracked')}
        onClick={() => openRollback()}
      >
        <Icon name="vcs/revert" />
      </button>
    </>
  )
}

const shortcutLabel = (id: string): string => {
  const shortcut = shortcutFor(id)
  return shortcut ? ` (${shortcut})` : ''
}

export function CommitView({ visible }: { visible: boolean }) {
  const status = useStore(gitState, (s) => s.status)
  const focus = useStore(workbench, (s) => s.focus)
  const [included, setIncluded] = useState(() => new Set<string>())
  const [known, setKnown] = useState(() => new Set<string>())
  const [message, setMessage] = useState('')
  const [selected, setSelected] = useState(0)
  const [busy, setBusy] = useState(false)
  const tree = useRef<HTMLDivElement>(null)
  const messageRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (visible) void refreshGit()
  }, [visible])

  useEffect(() => {
    if (visible && focus.target === 'Commit') messageRef.current?.focus()
  }, [focus, visible])

  // New tracked changes start included, unversioned files excluded; earlier choices stay.
  const paths = status.files.map((f) => f.path).join('\0')
  if (paths !== [...known].join('\0')) {
    const nextIncluded = new Set([...included].filter((p) => status.files.some((f) => f.path === p)))
    for (const file of status.files) if (!known.has(file.path) && file.kind !== 'untracked') nextIncluded.add(file.path)
    setKnown(new Set(status.files.map((f) => f.path)))
    setIncluded(nextIncluded)
  }

  const rows = useMemo(() => {
    const tracked = status.files.filter((f) => f.kind !== 'untracked')
    const untracked = status.files.filter((f) => f.kind === 'untracked')
    const result: Row[] = []
    if (tracked.length > 0) result.push({ kind: 'group', title: 'Changes', files: tracked }, ...tracked.map((file) => ({ kind: 'file' as const, file })))
    if (untracked.length > 0) {
      result.push({ kind: 'group', title: 'Unversioned Files', files: untracked }, ...untracked.map((file) => ({ kind: 'file' as const, file })))
    }
    return result
  }, [status])

  const toggle = (paths: string[], on: boolean): void =>
    setIncluded((prev) => {
      const next = new Set(prev)
      for (const p of paths) {
        if (on) next.add(p)
        else next.delete(p)
      }
      return next
    })

  const run = async (push: boolean): Promise<void> => {
    if (busy) return
    setBusy(true)
    const ok = await commitFiles(message, [...included], push)
    setBusy(false)
    if (ok) setMessage('')
  }

  // The selected change (or group) is what Rollback starts with.
  const selectedRow = rows[selected]
  useEffect(() => {
    changesSelection.set({ paths: !selectedRow ? [] : selectedRow.kind === 'group' ? selectedRow.files.map((f) => f.path) : [selectedRow.file.path] })
  }, [selectedRow])

  const showDiff = (row: Row | undefined): void => {
    if (row?.kind === 'file' && row.file.kind !== 'untracked') openVcsDiffTab(row.file.path)
  }
  useListNavigation(tree, rows, selected, setSelected, showDiff)

  const state = useRef({ rows, selected, message, included, run })
  useEffect(() => {
    state.current = { rows, selected, message, included, run }
  })
  useActions(() => {
    const inView = (): boolean => tree.current?.parentElement?.contains(document.activeElement) ?? false
    return [
      { id: 'Diff.ShowDiff', isEnabled: () => tree.current?.contains(document.activeElement) ?? false, perform: () => showDiff(state.current.rows[state.current.selected]) },
      {
        id: 'Commit.Execute',
        isEnabled: () => inView() && state.current.message.trim() !== '' && state.current.included.size > 0,
        perform: () => void state.current.run(false),
      },
    ]
  }, [])

  if (!status.repository) return <div className="empty-state">This project is not a git repository.</div>

  const canCommit = message.trim() !== '' && included.size > 0 && !busy
  return (
    <div className="commit-view">
      {rows.length === 0 ? (
        <div className="empty-state">No changes</div>
      ) : (
        <div className="tree" tabIndex={0} ref={tree} data-focus-area="tree" role="tree" aria-label="Changes">
          {rows.map((row, index) =>
            row.kind === 'group' ? (
              <div key={row.title} role="treeitem" className={`tree-row${index === selected ? ' selected' : ''}`} onMouseDown={() => setSelected(index)}>
                <input
                  type="checkbox"
                  aria-label={`Include ${row.title}`}
                  checked={row.files.every((f) => included.has(f.path))}
                  onChange={(e) => toggle(row.files.map((f) => f.path), e.target.checked)}
                />
                <span>{row.title}</span>
                <span className="group-count">
                  {row.files.length} {row.files.length === 1 ? 'file' : 'files'}
                </span>
              </div>
            ) : (
              <div
                key={row.file.path}
                role="treeitem"
                aria-selected={index === selected}
                className={`tree-row${index === selected ? ' selected' : ''}`}
                style={{ paddingLeft: 26 }}
                onMouseDown={() => setSelected(index)}
                onDoubleClick={() => showDiff(row)}
              >
                <input
                  type="checkbox"
                  aria-label={`Include ${row.file.relativePath}`}
                  checked={included.has(row.file.path)}
                  onChange={(e) => toggle([row.file.path], e.target.checked)}
                />
                <Icon name={fileIconName(basename(row.file.path))} />
                <span className={`vcs-${row.file.kind}`}>{basename(row.file.path)}</span>
                <span className="hint">{dirname(row.file.relativePath) === '/' ? '' : dirname(`/${row.file.relativePath}`).slice(1)}</span>
              </div>
            ),
          )}
        </div>
      )}
      <div className="commit-panel">
        <textarea
          ref={messageRef}
          className="commit-message"
          placeholder="Commit Message"
          aria-label="Commit Message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          spellCheck={false}
        />
        <div className="commit-buttons">
          <button className="button primary" disabled={!canCommit} onClick={() => void run(false)}>
            Commit
          </button>
          <button className="button secondary" disabled={!canCommit} onClick={() => void run(true)}>
            Commit and Push…
          </button>
        </div>
      </div>
    </div>
  )
}
