// Renderer-wide keymap wiring: one action registry, the macOS keymap and a capture-phase key
// listener that runs before Monaco and xterm see the event.
import { useEffect, useSyncExternalStore } from 'react'
import { ActionRegistry, type ActionDefinition, type FocusArea } from './actions'
import { actionText } from './actionTexts'
import { KeymapDispatcher } from './dispatcher'
import type { Keymap } from './keymap'
import { loadMacKeymap } from './macKeymap'
import { shortcutLabel } from './shortcut'

export const actions = new ActionRegistry()

let keymap: Keymap | null = null

export function activeKeymap(): Keymap {
  keymap ??= loadMacKeymap({ binding: (id) => actions.binding(id) })
  return keymap
}

const FOCUS_AREAS: ReadonlySet<string> = new Set<FocusArea>(['editor', 'terminal', 'run', 'tree', 'popup', 'dialog', 'other'])

/** Focus area of the focused element: the closest [data-focus-area] ancestor. */
export function currentFocusArea(): FocusArea {
  const area = document.activeElement?.closest('[data-focus-area]')?.getAttribute('data-focus-area')
  return area && FOCUS_AREAS.has(area) ? (area as FocusArea) : 'other'
}

const dispatcher = new KeymapDispatcher(activeKeymap, actions, currentFocusArea)

export function installKeymapDispatcher(target: Window = window): () => void {
  const listener = (event: KeyboardEvent): void => {
    if (event.isComposing) return
    const consumed = dispatcher.dispatch({
      type: event.type === 'keyup' ? 'keyup' : 'keydown',
      code: event.code,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      altKey: event.altKey,
      repeat: event.repeat,
      timeStamp: event.timeStamp,
    })
    if (consumed) {
      event.preventDefault()
      event.stopPropagation()
    }
  }
  target.addEventListener('keydown', listener, true)
  target.addEventListener('keyup', listener, true)
  return () => {
    target.removeEventListener('keydown', listener, true)
    target.removeEventListener('keyup', listener, true)
  }
}

/** Runs an action as if it were invoked from the UI (menus, buttons, popups). */
export function performAction(actionId: string): boolean {
  return actions.perform(actionId, { focusArea: currentFocusArea() })
}

/** First shortcut of an action in macOS notation, e.g. "⇧⌘O". */
export function shortcutFor(actionId: string): string | undefined {
  const first = activeKeymap().getShortcuts(actionId)[0]
  return first ? shortcutLabel(first) : undefined
}

export function actionLabel(action: Pick<ActionDefinition, 'id' | 'text'>): string {
  return action.text ?? actionText(action.id) ?? action.id
}

/** Registers actions for the lifetime of a component. Definitions are read through a ref-like getter. */
export function useActions(definitions: () => ActionDefinition[], deps: readonly unknown[]): void {
  useEffect(() => {
    const unregister = definitions().map((definition) => actions.register(definition))
    return () => unregister.forEach((fn) => fn())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

/** Re-renders when actions are registered or removed. */
export function useActionRegistryVersion(): number {
  return useSyncExternalStore(
    (listener) => actions.subscribe(listener),
    () => actions.version,
  )
}
