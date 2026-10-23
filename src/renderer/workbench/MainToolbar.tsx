import { useEffect, useState } from 'react'
import { performAction, shortcutFor } from '../keymap/service'
import { RunWidget } from '../run/RunWidget'
import { useStore } from '../state/store'
import { workbench } from '../state/workbench'
import { Icon } from '../ui/Icon'

function initials(name: string): string {
  const words = name.split(/[\s_.-]+|(?=[A-Z])/).filter(Boolean)
  return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase() || '?'
}

function useBranch(root: string | undefined): string | null {
  const [branch, setBranch] = useState<string | null>(null)
  useEffect(() => {
    if (!root) return
    let cancelled = false
    const refresh = () =>
      void window.anycode.invoke('git:branch', root).then((b) => {
        if (!cancelled) setBranch(b)
      })
    refresh()
    // The agent switches branches in the terminal; poll cheaply until a file watcher exists.
    const timer = setInterval(refresh, 5000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [root])
  return branch
}

export function MainToolbar() {
  const project = useStore(workbench, (s) => s.project)
  const branch = useBranch(project?.root)
  return (
    <div className="main-toolbar">
      {project && (
        <button className="toolbar-widget" title={project.root} onClick={() => performAction('$LRU')}>
          <span className="project-avatar">{initials(project.name)}</span>
          <span>{project.name}</span>
          <Icon name="general/chevronDown" size={14} />
        </button>
      )}
      {branch && (
        <button className="toolbar-widget secondary" title="Git branch">
          <Icon name="general/vcs" />
          <span>{branch}</span>
          <Icon name="general/chevronDown" size={14} />
        </button>
      )}
      <div className="toolbar-spacer" />
      <RunWidget />
      <button
        className="toolbar-icon"
        title={`Search Everywhere (${shortcutFor('SearchEverywhere') ?? ''})`}
        onClick={() => performAction('SearchEverywhere')}
      >
        <Icon name="general/search" />
      </button>
      <button className="toolbar-icon" title="Settings" disabled>
        <Icon name="general/settings" />
      </button>
    </div>
  )
}
