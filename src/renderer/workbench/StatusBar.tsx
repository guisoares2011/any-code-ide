import { relativePath } from '@shared/paths'
import { bridgeStatus } from '../bridge/bridgeClient'
import { useStore } from '../state/store'
import { workbench } from '../state/workbench'
import { Icon } from '../ui/Icon'

export function StatusBar() {
  const project = useStore(workbench, (s) => s.project)
  const activeTab = useStore(workbench, (s) => s.activeTab)
  const caret = useStore(workbench, (s) => s.caret)
  const isFile = useStore(workbench, (s) => s.tabs.find((t) => t.path === s.activeTab)?.kind === 'file')
  const clients = useStore(bridgeStatus, (s) => s.clients)
  const running = useStore(bridgeStatus, (s) => s.running)
  const crumbs =
    project && activeTab && isFile ? [project.name, ...relativePath(project.root, activeTab).split('/')] : project ? [project.name] : []

  return (
    <div className="status-bar">
      <div className="breadcrumbs">
        {crumbs.map((crumb, index) => (
          <span key={index} style={{ display: 'contents' }}>
            {index > 0 && <Icon name="general/chevronRight" size={12} />}
            <span className="crumb">{crumb}</span>
          </span>
        ))}
      </div>
      <div className="toolbar-spacer" />
      {activeTab && isFile && caret && <span className="widget">{`${caret.line}:${caret.column}`}</span>}
      {running && (
        <span
          className="widget"
          title={clients > 0 ? 'Claude Code is connected to AnyCode (/ide)' : 'Waiting for Claude Code to connect'}
        >
          <span className={`bridge-dot${clients > 0 ? ' connected' : ''}`} />
          {clients > 0 ? 'Claude connected' : 'Claude'}
        </span>
      )}
    </div>
  )
}
