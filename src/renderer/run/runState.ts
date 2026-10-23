import type { RunConfiguration } from '@shared/ipc'
import { createStore } from '../state/store'
import { showToolWindow, workbench } from '../state/workbench'
import { currentRunGroup } from '../terminal/ptySessions'

export const runState = createStore<{ configurations: RunConfiguration[]; selected: string | null }>({
  configurations: [],
  selected: null,
})

export async function loadRunConfigurations(root: string): Promise<void> {
  const configurations = await window.anycode.invoke('run:configurations', root)
  runState.set((s) => ({
    configurations,
    selected: s.selected && configurations.some((c) => c.id === s.selected) ? s.selected : (configurations[0]?.id ?? null),
  }))
}

export function selectedConfiguration(): RunConfiguration | undefined {
  const { configurations, selected } = runState.get()
  return configurations.find((c) => c.id === selected)
}

/** Runs a configuration in the Run tool window, reusing its tab when it already has one. */
export async function runConfiguration(configuration: RunConfiguration): Promise<void> {
  const root = workbench.get().project?.root
  if (!root) return
  runState.set({ selected: configuration.id })
  showToolWindow('Run', false)
  const runGroup = currentRunGroup()
  const existing = runGroup.findByTag(configuration.id)
  if (existing) {
    runGroup.activate(existing.id)
    await runGroup.restart(existing.id)
  } else {
    await runGroup.create({ title: configuration.name, cwd: root, command: configuration.command, tag: configuration.id })
  }
}

export function runSelected(): void {
  const configuration = selectedConfiguration()
  if (configuration) void runConfiguration(configuration)
}

export function stopActive(): void {
  const runGroup = currentRunGroup()
  const active = runGroup.activeInfo()
  if (active?.running) runGroup.stop(active.id)
}

export function rerunActive(): void {
  const runGroup = currentRunGroup()
  const active = runGroup.activeInfo()
  if (active) void runGroup.restart(active.id)
}
