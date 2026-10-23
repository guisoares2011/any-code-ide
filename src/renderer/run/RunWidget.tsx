import { useEffect } from 'react'
import { performAction, shortcutFor, useActions } from '../keymap/service'
import { useStore } from '../state/store'
import { openPopup, workbench } from '../state/workbench'
import { currentRunGroup, useRunGroup } from '../terminal/ptySessions'
import { Icon } from '../ui/Icon'
import { loadRunConfigurations, rerunActive, runSelected, runState, selectedConfiguration, stopActive } from './runState'

/** Toolbar run widget: configuration selector, Run and Stop (New UI RedesignedRunConfigurationSelector). */
export function RunWidget() {
  const project = useStore(workbench, (s) => s.project)
  const configurations = useStore(runState, (s) => s.configurations)
  const selected = useStore(runState, (s) => s.selected)
  const runGroup = useRunGroup()
  // Re-render on run state changes so Stop enables while something runs.
  const runActive = useStore(runGroup.store, (s) => s.active)
  useStore(runGroup.store, (s) => s.list)
  const running = runActive ? runGroup.isRunning(runActive) : false
  const current = configurations.find((c) => c.id === selected)

  useEffect(() => {
    if (project) void loadRunConfigurations(project.root)
  }, [project])

  useActions(
    () => [
      { id: 'Run', isEnabled: () => selectedConfiguration() !== undefined, perform: runSelected },
      { id: 'Stop', isEnabled: () => currentRunGroup().activeInfo()?.running ?? false, perform: stopActive },
      // In the editor ⌘R is Replace; Rerun owns it in the Run tool window.
      { id: 'Rerun', isEnabled: (c) => c.focusArea === 'run' && currentRunGroup().activeInfo() !== undefined, perform: rerunActive },
      { id: 'ChooseRunConfiguration', perform: () => openPopup('ChooseRunConfiguration') },
      { id: 'RedesignedRunConfigurationSelector', perform: () => openPopup('ChooseRunConfiguration') },
    ],
    [],
  )

  return (
    <>
      <button
        className="toolbar-widget secondary"
        title="Select Run/Debug Configuration"
        onClick={() => performAction('RedesignedRunConfigurationSelector')}
      >
        <span>{current ? current.name : configurations.length ? 'Select configuration' : 'No configurations'}</span>
        <Icon name="general/chevronDown" size={14} />
      </button>
      <button
        className="toolbar-icon run"
        title={`Run '${current?.name ?? ''}' (${shortcutFor('Run') ?? ''})`}
        disabled={!current}
        onClick={() => performAction('Run')}
      >
        <Icon name="run/run" />
      </button>
      <button
        className={`toolbar-icon${running ? ' stop' : ''}`}
        title={`Stop (${shortcutFor('Stop') ?? ''})`}
        disabled={!running}
        onClick={() => performAction('Stop')}
      >
        <Icon name="run/stop" />
      </button>
    </>
  )
}
