import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import type { RecentProject } from '@shared/ipc'
import appIcon from '../../../build/icon.svg?url'
import { shortcutFor, useActions } from '../keymap/service'
import { highlight } from '../popups/SearchPopup'
import { rank } from '../popups/fuzzy'
import { SettingsDialog, openSettings } from '../settings/SettingsDialog'
import { notifications } from '../state/notifications'
import { openProjectPath, pickAndOpenProject } from '../state/projects'
import { useStore } from '../state/store'
import { ContextMenuHost, showContextMenu, type MenuItem } from '../ui/ContextMenu'
import { askConfirm, DialogHost } from '../ui/dialogs'
import { Icon } from '../ui/Icon'
import { ProjectAvatar } from '../ui/projectAvatar'
import { useListNavigation } from '../ui/useListNavigation'

/** "/Users/me/Documents/app" → "~/Documents/app". */
function displayPath(path: string, home: string): string {
  return home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path
}

/**
 * IntelliJ's Welcome screen, shown by a window without projects (at startup, unless "Reopen projects
 * on startup" is on, and after its last project closes): the recent projects of AnyCode and of the
 * JetBrains IDEs, a search field and Open.
 */
export function WelcomeScreen() {
  const [recent, setRecent] = useState<RecentProject[]>([])
  const [app, setApp] = useState({ version: '', home: '' })
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [since] = useState(() => Date.now())
  const containerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  // Opening a project that is gone fails with a notification; this screen has no Notifications tool window.
  const error = useStore(notifications, (s) => s.items.find((n) => n.type === 'error' && n.time >= since) ?? null)

  const reload = (): void => void window.anycode.invoke('project:recent').then(setRecent)
  useEffect(() => {
    reload()
    void window.anycode.invoke('app:info').then(({ version, home }) => setApp({ version, home }))
    searchRef.current?.focus()
  }, [])

  const items = useMemo(() => rank(query, recent, (p) => p.name), [query, recent])
  const current = Math.min(selected, Math.max(items.length - 1, 0))
  useEffect(() => {
    listRef.current?.querySelector('.welcome-project.selected')?.scrollIntoView({ block: 'nearest' })
  }, [current, items])

  const open = (project: RecentProject): void => void openProjectPath(project.path)
  const forget = async (project: RecentProject): Promise<void> => {
    const answer = await askConfirm({
      title: 'Remove Recent Project',
      message: `Remove '${project.name}' from the recent projects list?`,
      confirmLabel: 'Remove',
    })
    if (!answer) return
    await window.anycode.invoke('project:forgetRecent', project.path)
    reload()
  }
  const menu = (event: MouseEvent, project: RecentProject, index: number): void => {
    event.preventDefault()
    event.stopPropagation()
    setSelected(index)
    const items: MenuItem[] = [
      { label: 'Open', run: () => open(project) },
      { label: 'Copy Path', run: () => void navigator.clipboard.writeText(project.path) },
      'separator',
      { label: 'Remove from Recent Projects…', run: () => void forget(project) },
    ]
    showContextMenu(event.clientX, event.clientY, items)
  }

  useListNavigation(containerRef, items, current, setSelected, ({ item }) => open(item))
  const state = useRef({ items, current, forget })
  useEffect(() => {
    state.current = { items, current, forget }
  })
  useActions(
    () => [
      { id: 'OpenFile', text: 'Open…', perform: () => void pickAndOpenProject() },
      {
        // Delete on the list (not while typing in the search field) removes the selected project.
        id: '$Delete',
        isEnabled: () => (listRef.current?.contains(document.activeElement) ?? false) && state.current.items.length > 0,
        perform: () => {
          const item = state.current.items[state.current.current]
          if (item) void state.current.forget(item.item)
        },
      },
    ],
    [],
  )

  return (
    <div className="welcome">
      <div className="welcome-title">Welcome to AnyCode</div>
      <div className="welcome-side">
        <div className="welcome-app">
          <img src={appIcon} width={40} height={40} alt="" draggable={false} />
          <div>
            <div className="welcome-app-name">AnyCode</div>
            <div className="welcome-app-version">{app.version}</div>
          </div>
        </div>
        <nav className="welcome-nav">
          <button className="welcome-nav-item selected">Projects</button>
        </nav>
        <span className="toolbar-spacer" />
        <button className="toolbar-icon" title={`Settings… (${shortcutFor('ShowSettings') ?? ''})`} aria-label="Settings" onClick={() => openSettings()}>
          <Icon name="general/settings" />
        </button>
      </div>
      <div className="welcome-main" ref={containerRef}>
        <div className="welcome-header">
          <label className="welcome-search">
            <Icon name="general/search" />
            <input
              ref={searchRef}
              placeholder="Search projects"
              aria-label="Search projects"
              spellCheck={false}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setSelected(0)
              }}
            />
          </label>
          <button className="button secondary" title={shortcutFor('OpenFile')} onClick={() => void pickAndOpenProject()}>
            Open
          </button>
        </div>
        {error && <div className="welcome-error">{error.message}</div>}
        <div className="welcome-projects" ref={listRef} role="listbox" aria-label="Recent projects" tabIndex={0}>
          {items.map(({ item, match }, index) => (
            <div
              key={item.path}
              className={`welcome-project${index === current ? ' selected' : ''}`}
              role="option"
              aria-selected={index === current}
              title={`${item.path} · ${item.source}`}
              onMouseDown={() => setSelected(index)}
              onClick={() => open(item)}
              onContextMenu={(e) => menu(e, item, index)}
            >
              <ProjectAvatar name={item.name} path={item.path} size={28} />
              <div className="welcome-project-text">
                <div className="welcome-project-name">{highlight(item.name, match.positions, 0)}</div>
                <div className="welcome-project-path">{displayPath(item.path, app.home)}</div>
              </div>
              <button className="toolbar-icon welcome-project-more" aria-label="More" onClick={(e) => menu(e, item, index)}>
                <Icon name="general/moreVertical" />
              </button>
            </div>
          ))}
          {items.length === 0 && <div className="empty-state">{query ? `No projects match “${query}”` : 'No recent projects. Open a folder to start.'}</div>}
        </div>
      </div>
      <SettingsDialog />
      <DialogHost />
      <ContextMenuHost />
    </div>
  )
}
