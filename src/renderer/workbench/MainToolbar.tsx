import { performAction, shortcutFor } from '../keymap/service'
import { RunWidget } from '../run/RunWidget'
import { gitState } from '../state/git'
import { useStore } from '../state/store'
import { openPopup, workbench } from '../state/workbench'
import { Icon } from '../ui/Icon'

function initials(name: string): string {
  const words = name.split(/[\s_.-]+|(?=[A-Z])/).filter(Boolean)
  return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase() || '?'
}

export function MainToolbar() {
  const project = useStore(workbench, (s) => s.project)
  // Refreshed by the watcher, which lets .git/HEAD through, so the agent's checkouts show up too.
  const branch = useStore(gitState, (s) => s.status.branch)
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
        <button className="toolbar-widget secondary" title="Git branch" onClick={() => openPopup('Branches')}>
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
      <button className="toolbar-icon" title={`Settings… (${shortcutFor('ShowSettings') ?? ''})`} aria-label="Settings" onClick={() => performAction('ShowSettings')}>
        <Icon name="general/settings" />
      </button>
    </div>
  )
}
