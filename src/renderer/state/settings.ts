// User settings in the renderer: loaded at startup, saved by the Settings dialog. Components read
// the current values when they create editors and terminals; open ones follow changes live.
import { DEFAULT_SETTINGS, type Settings } from '@shared/settings'
import { createStore } from './store'

export const settingsState = createStore<{ settings: Settings }>({ settings: DEFAULT_SETTINGS })

export const currentSettings = (): Settings => settingsState.get().settings

export async function loadSettings(): Promise<void> {
  settingsState.set({ settings: await window.anycode.invoke('settings:get') })
}

export async function saveSettings(settings: Settings): Promise<void> {
  settingsState.set({ settings: await window.anycode.invoke('settings:set', settings) })
}

/** Font options for Monaco editors and diff editors. */
export function editorFont(): { fontSize: number; lineHeight: number } {
  const { fontSize, lineHeight } = currentSettings().editor
  return { fontSize, lineHeight }
}

/** Calls `apply` with the settings now and on every change of the selected part. */
export function followSettings<T>(select: (settings: Settings) => T, apply: (value: T) => void): () => void {
  let last = select(currentSettings())
  apply(last)
  return settingsState.subscribe(() => {
    const next = select(currentSettings())
    if (JSON.stringify(next) === JSON.stringify(last)) return
    last = next
    apply(next)
  })
}
