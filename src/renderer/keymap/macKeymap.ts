// The default macOS keymap: "$default" -> "Mac OS X 10.5+", from the IntelliJ 2026.1 data files,
// plus the shortcuts that the terminal plugin and the VCS platform modules declare themselves.
import defaultXml from '@intellij/platform/platform-resources/src/keymaps/$default.xml?raw'
import macXml from '@intellij/platform/platform-resources/src/keymaps/Mac OS X 10.5+.xml?raw'
import terminalFrontendXml from '@intellij/plugins/terminal/frontend/resources/intellij.terminal.frontend.xml?raw'
import terminalPluginXml from '@intellij/plugins/terminal/resources/META-INF/plugin.xml?raw'
import dvcsActionsXml from '@intellij/platform/dvcs-impl/resources/intellij.platform.vcs.dvcs.impl.xml?raw'
import vcsActionsXml from '@intellij/platform/vcs-impl/resources/META-INF/VcsActions.xml?raw'
import { COMPONENT_SHORTCUTS } from './componentShortcuts'
import { Keymap, type ActionBinding } from './keymap'
import { parseKeymapXml, parsePluginShortcuts, type KeymapOperation } from './keymapXml'
import { gestureShortcut, keyboardShortcut, type Shortcut } from './shortcut'

export const DEFAULT_KEYMAP = '$default'
export const MAC_KEYMAP = 'Mac OS X 10.5+'

/**
 * Modifier double-click shortcuts that IntelliJ 2026.1 registers in code (ModifierKeyDoubleClickHandler).
 * intellij-community master declares the same entries in $default.xml since commit 11c6da14af
 * (IJPL-61450); they are added only when the loaded XML does not declare the action yet.
 */
const DECLARATIVE_GESTURES: readonly [actionId: string, keystroke: string][] = [
  ['SearchEverywhere', 'shift SHIFT'],
  ['RunAnything', 'ctrl CONTROL'],
]

export interface MacKeymapOptions {
  /** use-shortcut-of declared by registered actions. */
  binding?: ActionBinding
  /** Extra plugin descriptors whose <keyboard-shortcut keymap=...> entries apply. */
  pluginXmls?: readonly string[]
}

export function loadMacKeymap(options: MacKeymapOptions = {}): Keymap {
  // Platform and plugin descriptors whose actions declare their own keymap entries.
  const plugins = parsePluginShortcuts(terminalPluginXml)
  for (const xml of [terminalFrontendXml, vcsActionsXml, dvcsActionsXml]) parsePluginShortcuts(xml, plugins)
  for (const xml of options.pluginXmls ?? []) parsePluginShortcuts(xml, plugins)
  const binding: ActionBinding = (id) => options.binding?.(id) ?? plugins.bindings.get(id)

  const defaultDefinition = parseKeymapXml(defaultXml, { skipInsertKeystrokes: true })
  for (const [actionId, keystroke] of DECLARATIVE_GESTURES) {
    const gesture = gestureShortcut(keystroke, 'dblClick')
    if (gesture && !defaultDefinition.actions.has(actionId)) defaultDefinition.actions.set(actionId, [gesture])
  }
  for (const [actionId, keystrokes] of COMPONENT_SHORTCUTS) {
    if (defaultDefinition.actions.has(actionId)) continue
    const shortcuts: Shortcut[] = keystrokes.flatMap((k) => keyboardShortcut(k) ?? [])
    defaultDefinition.actions.set(actionId, shortcuts)
  }
  const defaults = Keymap.fromDefinition(defaultDefinition, null, binding)
  defaults.apply(operationsFor(plugins.operations, DEFAULT_KEYMAP))

  const mac = Keymap.fromDefinition(parseKeymapXml(macXml, { skipInsertKeystrokes: true }), defaults, binding)
  mac.apply(operationsFor(plugins.operations, MAC_KEYMAP))
  return mac
}

function operationsFor(operations: ReadonlyMap<string, KeymapOperation[]>, keymap: string): KeymapOperation[] {
  return operations.get(keymap) ?? []
}
