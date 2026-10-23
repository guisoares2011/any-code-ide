import { useEffect, useLayoutEffect, useRef } from 'react'
import { performAction, shortcutFor, useActions } from '../keymap/service'
import { useStore } from '../state/store'
import { workbench } from '../state/workbench'
import { currentRunGroup, useRunGroup } from '../terminal/ptySessions'
import { Icon } from '../ui/Icon'

/** Execution tabs shown in the Run tool window header. */
export function RunTabs() {
  const runGroup = useRunGroup()
  const { list, active } = useStore(runGroup.store, (s) => s)
  const running = active ? runGroup.isRunning(active) : false
  return (
    <>
      <div className="tool-window-tabs">
        {list.map((session) => (
          <div
            key={session.id}
            className={`tool-window-tab${session.id === active ? ' selected' : ''}`}
            onMouseDown={() => runGroup.activate(session.id)}
          >
            <Icon name={session.exited ? (session.exitCode === 0 ? 'general/greenCheckmark' : 'general/errorDialog') : 'run/run'} size={14} />
            <span>{session.title}</span>
            <button className="icon-button small tab-close" title="Close" onClick={() => runGroup.close(session.id)}>
              <Icon name="general/closeSmall" size={14} />
            </button>
          </div>
        ))}
      </div>
      {active && (
        <>
          <button className="icon-button" title={`Rerun (${shortcutFor('Rerun') ?? ''})`} onClick={() => performAction('Rerun')}>
            <Icon name="run/rerun" />
          </button>
          <button
            className="icon-button"
            title={`Stop (${shortcutFor('Stop') ?? ''})`}
            disabled={!running}
            style={{ opacity: running ? 1 : 0.4 }}
            onClick={() => performAction('Stop')}
          >
            <Icon name="run/stop" />
          </button>
        </>
      )}
    </>
  )
}

/** Mounted once per project (keyed by root), like the terminal. */
export function RunView({ visible }: { visible: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const runGroup = useRunGroup()
  const { list, active } = useStore(runGroup.store, (s) => s)
  const focus = useStore(workbench, (s) => s.focus)

  // Before any effect creates a session, so new terminals are measured first.
  useLayoutEffect(() => {
    if (host.current) runGroup.attach(host.current)
  })

  useEffect(() => {
    if (host.current) runGroup.mount(host.current)
  }, [runGroup, list, active, visible])

  useEffect(() => {
    if (!host.current) return
    const observer = new ResizeObserver(() => runGroup.fitActive())
    observer.observe(host.current)
    return () => observer.disconnect()
  }, [runGroup])

  useEffect(() => {
    if (visible && focus.target === 'Run') runGroup.focusActive()
  }, [runGroup, focus, visible])

  useActions(
    () => [
      { id: 'NextTab', isEnabled: (c) => c.focusArea === 'run', perform: () => currentRunGroup().selectAdjacent(1) },
      { id: 'PreviousTab', isEnabled: (c) => c.focusArea === 'run', perform: () => currentRunGroup().selectAdjacent(-1) },
      {
        id: '$Copy',
        isEnabled: (c) => c.focusArea === 'run' && currentRunGroup().hasSelection(),
        perform: () => currentRunGroup().copySelection(),
      },
    ],
    [],
  )

  // The host stays mounted (sessions are measured in it before their process starts).
  return (
    <>
      <div className="terminal-host" ref={host} data-focus-area="run" />
      {list.length === 0 && (
        <div className="empty-state">
          Nothing is running.
          <br />
          Choose a configuration in the toolbar or press {shortcutFor('ChooseRunConfiguration') ?? ''}.
        </div>
      )}
    </>
  )
}
