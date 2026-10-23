import type { RunConfigurationSpec } from '@shared/runConfigurations'
import { notify } from '../state/notifications'
import { createStore } from '../state/store'
import { showToolWindow, workbench } from '../state/workbench'
import { currentRunGroup } from '../terminal/ptySessions'

export const runState = createStore<{ configurations: RunConfigurationSpec[]; selected: string | null; editing: boolean }>({
  configurations: [],
  selected: null,
  editing: false,
})

/** Temporary configurations per project (tests run from the editor), newest last, like IntelliJ's. */
const temporaries = new Map<string, RunConfigurationSpec[]>()
const MAX_TEMPORARY = 5

export async function loadRunConfigurations(root: string): Promise<void> {
  const saved = await window.anycode.invoke('run:configurations', root)
  const configurations = [...saved, ...(temporaries.get(root) ?? []).filter((t) => !saved.some((c) => c.name === t.name))]
  runState.set((s) => ({
    configurations,
    selected: s.selected && configurations.some((c) => c.id === s.selected) ? s.selected : (configurations[0]?.id ?? null),
  }))
}

export async function reloadRunConfigurations(): Promise<void> {
  const root = workbench.get().project?.root
  if (root) await loadRunConfigurations(root)
}

export function selectedConfiguration(): RunConfigurationSpec | undefined {
  const { configurations, selected } = runState.get()
  return configurations.find((c) => c.id === selected)
}

/** Runs a configuration created on the fly (a test from the editor), keeping it selectable for a while. */
export async function runTemporary(configuration: RunConfigurationSpec): Promise<void> {
  const root = workbench.get().project?.root
  if (!root) return
  const list = (temporaries.get(root) ?? []).filter((t) => t.id !== configuration.id)
  temporaries.set(root, [...list, configuration].slice(-MAX_TEMPORARY))
  runState.set((s) => ({ configurations: [...s.configurations.filter((c) => c.id !== configuration.id), configuration] }))
  await runConfiguration(configuration)
}

/** Runs a configuration in the Run tool window, reusing its tab when it already has one. */
export async function runConfiguration(configuration: RunConfigurationSpec, select = true): Promise<void> {
  const root = workbench.get().project?.root
  if (!root) return
  if (select) runState.set({ selected: configuration.id })
  showToolWindow('Run', false)
  let command
  try {
    command = await window.anycode.invoke('run:command', root, configuration)
  } catch (error) {
    notify('error', `Cannot run ${configuration.name}`, error instanceof Error ? error.message : String(error))
    return
  }
  const runGroup = currentRunGroup()
  const tag = `${configuration.id}\0${command.script}`
  const existing = runGroup.findByTag(tag)
  if (existing) {
    runGroup.activate(existing.id)
    await runGroup.restart(existing.id)
  } else {
    await runGroup.create({ title: configuration.name, cwd: command.cwd, script: command.script, env: command.env, tag })
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

export function openRunConfigurationsEditor(): void {
  runState.set({ editing: true })
}

export function closeRunConfigurationsEditor(): void {
  runState.set({ editing: false })
}
