import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { basename, dirname, relativePath } from '@shared/paths'
import { actionLabel, actions, performAction, shortcutFor, useActions, useActionRegistryVersion } from '../keymap/service'
import type { RecentProject } from '@shared/ipc'
import { runConfiguration, runState } from '../run/runState'
import { openProjectPath, pickAndOpenProject } from '../state/projects'
import { useStore } from '../state/store'
import { closePopup, openFile, requestFocus, switchProject, workbench, type PopupKind } from '../state/workbench'
import { Icon } from '../ui/Icon'
import { fileIconName } from '../ui/icons'
import { rank } from './fuzzy'

type Tab = 'All' | 'Files' | 'Actions'

interface Item {
  key: string
  group: 'Recent Files' | 'Files' | 'Actions' | 'Run Configurations' | 'Open Projects' | 'Recent Projects'
  label: string
  hint?: string
  icon?: string
  shortcut?: string
  positions: number[]
  /** Offset of `label` inside the matched text, to map highlight positions. */
  labelOffset: number
  run(): void
}

// Component-level and internal ids that make no sense in Find Action.
const HIDDEN_ACTIONS = /^(Tree-|List-|Popup\.|EditSourceOnEnter$|SearchEverywhere\.)/

let fileCache: { root: string; files: string[] } | null = null

async function projectFiles(root: string): Promise<string[]> {
  if (fileCache?.root !== root) fileCache = { root, files: await window.anycode.invoke('fs:listFiles', root) }
  else void window.anycode.invoke('fs:listFiles', root).then((files) => (fileCache = { root, files }))
  return fileCache.files
}

const TITLES: Record<PopupKind, string> = {
  GotoFile: 'Files',
  RecentFiles: 'Recent Files',
  GotoAction: 'Actions',
  SearchEverywhere: 'All',
  ChooseRunConfiguration: 'Run',
  Projects: 'Projects',
}

const PLACEHOLDERS: Record<PopupKind, string> = {
  GotoFile: 'Type file name',
  RecentFiles: 'Recent files',
  GotoAction: 'Type action name',
  SearchEverywhere: 'Search files and actions',
  ChooseRunConfiguration: 'Run configuration',
  Projects: 'Open or switch project',
}

function initialTab(kind: PopupKind): Tab {
  return kind === 'GotoFile' ? 'Files' : kind === 'GotoAction' ? 'Actions' : 'All'
}

export function PopupHost() {
  const popup = useStore(workbench, (s) => s.popup)
  return popup ? <SearchPopup key={popup} kind={popup} /> : null
}

function SearchPopup({ kind }: { kind: PopupKind }) {
  const project = useStore(workbench, (s) => s.project)
  const recentFiles = useStore(workbench, (s) => s.recentFiles)
  const runConfigurations = useStore(runState, (s) => s.configurations)
  const openProjects = useStore(workbench, (s) => s.projects)
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([])

  useEffect(() => {
    if (kind === 'Projects') void window.anycode.invoke('project:recent').then(setRecentProjects)
  }, [kind])
  const registryVersion = useActionRegistryVersion()
  const [query, setQuery] = useState('')
  const [files, setFiles] = useState<string[]>([])
  const [tab, setTab] = useState<Tab>(initialTab(kind))
  const [selected, setSelected] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (project && (kind === 'GotoFile' || kind === 'SearchEverywhere')) void projectFiles(project.root).then(setFiles)
  }, [project, kind])

  const items = useMemo(() => {
    const root = project?.root ?? '/'
    const fileItem = (path: string, group: Item['group'], positions: number[], labelOffset: number): Item => ({
      key: `${group}:${path}`,
      group,
      label: basename(path),
      hint: dirname(relativePath(root, path)),
      icon: fileIconName(basename(path)),
      positions,
      labelOffset,
      run: () => openFile(path),
    })
    const result: Item[] = []
    if (kind === 'Projects') {
      for (const { item, match } of rank(query, openProjects, (p) => p.name)) {
        result.push({
          key: `open:${item.root}`,
          group: 'Open Projects',
          label: item.name,
          hint: item.root,
          icon: 'nodes/ideaProject',
          positions: match.positions,
          labelOffset: 0,
          run: () => switchProject(item.root),
        })
      }
      const others = recentProjects.filter((r) => !openProjects.some((p) => p.root === r.path))
      for (const { item, match } of rank(query, others, (p) => p.name, 30)) {
        result.push({
          key: `recent:${item.path}`,
          group: 'Recent Projects',
          label: item.name,
          hint: `${item.path} · ${item.source}`,
          icon: 'nodes/folder',
          positions: match.positions,
          labelOffset: 0,
          run: () => void openProjectPath(item.path),
        })
      }
      // A typed absolute path opens that directory directly.
      if (query.startsWith('/')) {
        result.push({
          key: `path:${query}`,
          group: 'Actions',
          label: `Open ${query}`,
          icon: 'nodes/folder',
          positions: [],
          labelOffset: 0,
          run: () => void openProjectPath(query.replace(/\/+$/, '') || '/'),
        })
        return result
      }
      const open = rank(query, [{ id: 'OpenFile', text: 'Open…' }], (a) => a.text)[0]
      if (open) {
        result.push({
          key: 'action:OpenFile',
          group: 'Actions',
          label: 'Open…',
          shortcut: shortcutFor('OpenFile'),
          positions: open.match.positions,
          labelOffset: 0,
          run: () => void pickAndOpenProject(),
        })
      }
      return result
    }
    if (kind === 'ChooseRunConfiguration') {
      for (const { item, match } of rank(query, runConfigurations, (c) => c.name)) {
        result.push({
          key: `run:${item.id}`,
          group: 'Run Configurations',
          label: item.name,
          hint: item.command.join(' '),
          icon: 'run/run',
          positions: match.positions,
          labelOffset: 0,
          run: () => void runConfiguration(item),
        })
      }
      return result
    }
    if (kind === 'RecentFiles') {
      for (const { item, match } of rank(query, recentFiles, (p) => basename(p))) result.push(fileItem(item, 'Recent Files', match.positions, 0))
      return result
    }
    if (tab !== 'Actions') {
      if (query === '' && kind === 'SearchEverywhere') {
        for (const path of recentFiles.slice(0, 10)) result.push(fileItem(path, 'Recent Files', [], 0))
      } else if (query !== '') {
        for (const { item, match } of rank(query, files, (f) => f, 100)) {
          result.push(fileItem(`${root}/${item}`, 'Files', match.positions, item.lastIndexOf('/') + 1))
        }
      }
    }
    if (tab !== 'Files' && (query !== '' || kind === 'GotoAction')) {
      const available = actions.all().filter((a) => !HIDDEN_ACTIONS.test(a.id))
      for (const { item, match } of rank(query, available, (a) => actionLabel(a), 50)) {
        result.push({
          key: `action:${item.id}`,
          group: 'Actions',
          label: actionLabel(item),
          shortcut: shortcutFor(item.id),
          positions: match.positions,
          labelOffset: 0,
          run: () => performAction(item.id),
        })
      }
    }
    return result
    // registryVersion: re-rank when actions change
  }, [query, files, tab, kind, project, recentFiles, runConfigurations, openProjects, recentProjects, registryVersion]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    listRef.current?.querySelector('.popup-item.selected')?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const state = useRef({ items, selected })
  useLayoutEffect(() => {
    state.current = { items, selected }
  })

  const dismiss = (): void => {
    closePopup()
    requestFocus(workbench.get().focus.target)
  }

  useActions(() => {
    const inPopup = (c: { focusArea: string }) => c.focusArea === 'popup'
    const move = (delta: number) => () =>
      setSelected((s) => {
        const count = state.current.items.length
        return count === 0 ? 0 : (s + delta + count) % count
      })
    const tabs: Tab[] = kind === 'SearchEverywhere' ? ['All', 'Files', 'Actions'] : []
    const cycle = (delta: number) => () => {
      setSelected(0)
      setTab((t) => (tabs.length ? tabs[(tabs.indexOf(t) + delta + tabs.length) % tabs.length]! : t))
    }
    return [
      { id: 'List-selectNextRow', isEnabled: inPopup, perform: move(1) },
      { id: 'List-selectPreviousRow', isEnabled: inPopup, perform: move(-1) },
      { id: 'SearchEverywhere.NextTab', isEnabled: inPopup, perform: cycle(1) },
      { id: 'SearchEverywhere.PrevTab', isEnabled: inPopup, perform: cycle(-1) },
      {
        id: 'Popup.Confirm',
        isEnabled: inPopup,
        perform: () => {
          const item = state.current.items[state.current.selected]
          closePopup()
          item?.run()
        },
      },
      { id: 'Popup.Cancel', isEnabled: inPopup, perform: dismiss },
    ]
  }, [kind])

  let lastGroup: string | null = null
  return (
    <div className="popup-backdrop" onMouseDown={dismiss}>
      <div className="popup" data-focus-area="popup" role="dialog" aria-label={TITLES[kind]} onMouseDown={(e) => e.stopPropagation()}>
        {kind === 'SearchEverywhere' && (
          <div className="popup-header">
            {(['All', 'Files', 'Actions'] as const).map((t) => (
              <button
                key={t}
                className={`popup-tab${t === tab ? ' selected' : ''}`}
                onClick={() => {
                  setTab(t)
                  setSelected(0)
                }}
              >
                {t}
              </button>
            ))}
          </div>
        )}
        <div className="popup-search">
          <Icon name="general/search" />
          <input
            autoFocus
            value={query}
            placeholder={PLACEHOLDERS[kind]}
            onChange={(event) => {
              setQuery(event.target.value)
              setSelected(0)
            }}
            spellCheck={false}
          />
        </div>
        <div className="popup-list" ref={listRef} role="listbox">
          {items.length === 0 && query !== '' && <div className="popup-empty">Nothing found</div>}
          {items.map((item, index) => {
            const header = item.group !== lastGroup && (kind === 'SearchEverywhere' || kind === 'Projects') ? item.group : null
            lastGroup = item.group
            return (
              <div key={item.key}>
                {header && <div className="popup-group">{header}</div>}
                <div
                  role="option"
                  aria-selected={index === selected}
                  className={`popup-item${index === selected ? ' selected' : ''}`}
                  onMouseMove={() => setSelected(index)}
                  onClick={() => {
                    closePopup()
                    item.run()
                  }}
                >
                  {item.icon && <Icon name={item.icon} />}
                  <span>{highlight(item.label, item.positions, item.labelOffset)}</span>
                  {item.hint && <span className="hint">{item.hint}</span>}
                  {item.shortcut && <span className="shortcut">{item.shortcut}</span>}
                </div>
              </div>
            )
          })}
        </div>
        <div className="popup-footer">
          {kind === 'SearchEverywhere' ? `Press ${shortcutFor('SearchEverywhere') ?? '⇧⇧'} to search everywhere` : `${items.length} results`}
        </div>
      </div>
    </div>
  )
}

function highlight(label: string, positions: readonly number[], offset: number): ReactNode {
  const marks = new Set(positions.map((p) => p - offset).filter((p) => p >= 0 && p < label.length))
  if (marks.size === 0) return label
  return [...label].map((ch, i) => (marks.has(i) ? <mark key={i}>{ch}</mark> : ch))
}
