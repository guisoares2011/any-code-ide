// Editor font size from the keyboard and the mouse, like IntelliJ's "Increase/Decrease/Reset Font
// Size" actions and "Change font size with ⌘+Mouse Wheel". The size is the Editor › Font setting,
// so it applies to every editor and diff and survives restarts.
import { DEFAULT_SETTINGS, normalizeSettings, resizeEditorFont, type Settings } from '@shared/settings'
import type { ActionDefinition } from '../keymap/actions'
import { currentSettings, settingsState } from '../state/settings'

const SAVE_DELAY_MS = 400
/** Accumulated wheel delta per step: one mouse wheel notch, or a short trackpad scroll or pinch. */
const WHEEL_STEP = 40

let saveTimer: ReturnType<typeof setTimeout> | undefined

function setEditorFont(editor: Settings['editor']): void {
  const settings = normalizeSettings({ ...currentSettings(), editor })
  // Applied at once (open editors follow settingsState) and saved when the steps stop.
  settingsState.set({ settings })
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void window.anycode.invoke('settings:set', currentSettings()), SAVE_DELAY_MS)
}

export const changeEditorFontSize = (steps: number): void => setEditorFont(resizeEditorFont(currentSettings().editor, steps))

export const resetEditorFontSize = (): void => setEditorFont(DEFAULT_SETTINGS.editor)

/**
 * ⌘+wheel (and the trackpad pinch, which Chromium reports as ctrl+wheel) over a Monaco editor inside
 * `root` changes the font size instead of scrolling. Returns the cleanup.
 */
export function attachWheelFontZoom(root: HTMLElement): () => void {
  let pending = 0
  const onWheel = (event: WheelEvent) => {
    if (!(event.metaKey || event.ctrlKey) || !(event.target instanceof Element) || !event.target.closest('.monaco-editor')) return
    event.preventDefault()
    event.stopPropagation()
    pending += event.deltaY
    if (Math.abs(pending) < WHEEL_STEP) return
    // Wheel up (negative delta) or pinch out makes the font larger.
    changeEditorFontSize(pending < 0 ? 1 : -1)
    pending = 0
  }
  // Capture: Monaco handles wheel events on its own elements and stops them.
  root.addEventListener('wheel', onWheel, { capture: true, passive: false })
  return () => root.removeEventListener('wheel', onWheel, { capture: true })
}

/** The editor font size actions; one editor area, so the "Global" and per-editor ids do the same. */
export function fontSizeActions(): ActionDefinition[] {
  return [
    { id: 'EditorIncreaseFontSizeGlobal', perform: () => changeEditorFontSize(1) },
    { id: 'EditorDecreaseFontSizeGlobal', perform: () => changeEditorFontSize(-1) },
    { id: 'EditorResetFontSizeGlobal', perform: resetEditorFontSize },
    { id: 'EditorIncreaseFontSize', perform: () => changeEditorFontSize(1) },
    { id: 'EditorDecreaseFontSize', perform: () => changeEditorFontSize(-1) },
    { id: 'EditorResetFontSize', perform: resetEditorFontSize },
  ]
}
