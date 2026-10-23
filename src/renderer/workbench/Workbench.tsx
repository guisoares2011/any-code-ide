import { EditorArea } from '../editor/EditorArea'
import { useActions } from '../keymap/service'
import { PopupHost } from '../popups/SearchPopup'
import { RunConfigurationsDialog } from '../run/RunConfigurationsDialog'
import { SettingsDialog } from '../settings/SettingsDialog'
import { VcsActions } from '../vcs/VcsActions'
import { useStore } from '../state/store'
import { setPanelSize, workbench } from '../state/workbench'
import { OpenProjectDialog } from './OpenProjectDialog'
import { MainToolbar } from './MainToolbar'
import { ProjectTabs } from './ProjectTabs'
import { Splitter } from './Splitter'
import { StatusBar } from './StatusBar'
import { Stripe } from './Stripe'
import { ToolWindowPanel } from './ToolWindowPanel'
import { workbenchActions } from './workbenchActions'

const MIN_SIDE = 180
const MIN_BOTTOM = 120

export function Workbench() {
  const visible = useStore(workbench, (s) => s.visible)
  const sizes = useStore(workbench, (s) => s.sizes)
  useActions(workbenchActions, [])

  return (
    <div className="workbench">
      <MainToolbar />
      <ProjectTabs />
      <div className="workbench-body">
        <Stripe side="left" />
        <div className="side-panel" style={{ width: sizes.left, display: visible.left ? undefined : 'none' }}>
          <ToolWindowPanel anchor="left" />
        </div>
        {visible.left && (
          <Splitter
            orientation="vertical"
            size={sizes.left}
            direction={1}
            min={MIN_SIDE}
            max={window.innerWidth * 0.5}
            onResize={(size) => setPanelSize('left', size)}
          />
        )}
        <div className="workbench-center">
          <EditorArea />
          {visible.bottom && (
            <Splitter
              orientation="horizontal"
              size={sizes.bottom}
              direction={-1}
              min={MIN_BOTTOM}
              max={window.innerHeight * 0.75}
              onResize={(size) => setPanelSize('bottom', size)}
            />
          )}
          <div className="bottom-panel" style={{ height: sizes.bottom, display: visible.bottom ? undefined : 'none' }}>
            <ToolWindowPanel anchor="bottom" />
          </div>
        </div>
        {visible.right && (
          <Splitter
            orientation="vertical"
            size={sizes.right}
            direction={-1}
            min={MIN_SIDE}
            max={window.innerWidth * 0.5}
            onResize={(size) => setPanelSize('right', size)}
          />
        )}
        <div className="side-panel" style={{ width: sizes.right, display: visible.right ? undefined : 'none' }}>
          <ToolWindowPanel anchor="right" />
        </div>
        <Stripe side="right" />
      </div>
      <StatusBar />
      <PopupHost />
      <RunConfigurationsDialog />
      <VcsActions />
      <OpenProjectDialog />
      <SettingsDialog />
    </div>
  )
}
