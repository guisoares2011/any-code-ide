import { useState, type ReactNode } from 'react'
import { shortcutFor } from '../keymap/service'
import { MavenHeaderActions, MavenView } from '../maven/MavenView'
import { NotificationsView } from '../notifications/NotificationsView'
import { ProblemsView } from '../problems/ProblemsView'
import { ProjectView } from '../project/ProjectView'
import { RunView, RunTabs } from '../run/RunView'
import { DebugTabs, DebugView } from '../debug/DebugView'
import { useStore } from '../state/store'
import { hideToolWindow, workbench, type Anchor, type ToolWindowId, TOOL_WINDOWS } from '../state/workbench'
import { StructureView } from '../structure/StructureView'
import { TerminalTabs, TerminalView } from '../terminal/TerminalView'
import { CommitHeaderActions, CommitView } from '../vcs/CommitView'
import { LogView } from '../vcs/LogView'
import { Icon } from '../ui/Icon'

function ToolWindowContent({ id, visible }: { id: ToolWindowId; visible: boolean }): ReactNode {
  const root = useStore(workbench, (s) => s.project?.root ?? '')
  switch (id) {
    case 'Project':
      return <ProjectView />
    case 'Terminal':
      return <TerminalView key={root} visible={visible} />
    case 'Run':
      return <RunView key={root} visible={visible} />
    case 'Debug':
      return <DebugView key={root} visible={visible} />
    case 'Commit':
      return <CommitView visible={visible} />
    case 'Structure':
      return <StructureView visible={visible} />
    case 'Problems View':
      return <ProblemsView />
    case 'Notifications':
      return <NotificationsView visible={visible} />
    case 'Maven':
      return <MavenView visible={visible} />
    case 'Version Control':
      return <LogView key={root} visible={visible} />
  }
}

function HeaderExtra({ id }: { id: ToolWindowId }): ReactNode {
  if (id === 'Terminal') return <TerminalTabs />
  if (id === 'Run') return <RunTabs />
  if (id === 'Debug') return <DebugTabs />
  if (id === 'Maven') return <MavenHeaderActions />
  if (id === 'Commit') return <CommitHeaderActions />
  return null
}

/**
 * The island of one anchor. Every tool window shown once stays mounted (hidden when inactive), so
 * terminal sessions and tree state survive switching and hiding.
 */
export function ToolWindowPanel({ anchor }: { anchor: Anchor }) {
  const active = useStore(workbench, (s) => s.visible[anchor])
  const [mounted, setMounted] = useState<ToolWindowId[]>([])
  if (active && !mounted.includes(active)) setMounted([...mounted, active])
  const spec = TOOL_WINDOWS.find((t) => t.id === active)

  return (
    <div className="island" data-anchor={anchor}>
      {spec && (
        <div className="tool-window-header">
          <span className="tool-window-title">{spec.title}</span>
          <HeaderExtra id={spec.id} />
          <div className="tool-window-actions">
            <button
              className="icon-button"
              title={`Hide (${shortcutFor('HideActiveWindow') ?? ''})`}
              onClick={() => hideToolWindow(spec.id)}
            >
              <Icon name="general/hide" />
            </button>
          </div>
        </div>
      )}
      {mounted
        .filter((id) => TOOL_WINDOWS.find((t) => t.id === id)?.anchor === anchor)
        .map((id) => (
          <div
            key={id}
            className="tool-window-content"
            data-tool-window={id}
            style={{ display: id === active ? undefined : 'none' }}
          >
            <ToolWindowContent id={id} visible={id === active} />
          </div>
        ))}
    </div>
  )
}
