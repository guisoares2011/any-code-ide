// Parsers for the two places IntelliJ declares shortcuts: keymap XMLs (<keymap><action>...) and
// plugin descriptors (<actions><action><keyboard-shortcut keymap="...">).
import { XMLParser } from 'fast-xml-parser'
import { gestureShortcut, keyboardShortcut, mouseShortcut, type Shortcut } from './shortcut'

export interface KeymapDefinition {
  name: string
  parent?: string
  /** Own shortcuts per action id; an empty list removes the parent's shortcuts. */
  actions: Map<string, Shortcut[]>
}

export type KeymapOperation =
  | { kind: 'add'; actionId: string; shortcut: Shortcut }
  | { kind: 'remove'; actionId: string; shortcut: Shortcut }
  | { kind: 'removeAll'; actionId: string }

export interface PluginShortcuts {
  /** Operations per keymap name, in declaration order (KeymapShortcutOperation). */
  operations: Map<string, KeymapOperation[]>
  /** use-shortcut-of bindings declared on actions. */
  bindings: Map<string, string>
}

type XmlNode = Record<string, unknown>

/** String attribute of a parsed element (attributes are not prefixed). */
const attr = (node: XmlNode, name: string): string | undefined => {
  const value = node[name]
  return typeof value === 'string' ? value : undefined
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  isArray: (name) =>
    ['action', 'group', 'keyboard-shortcut', 'mouse-shortcut', 'keyboard-gesture-shortcut', 'actions'].includes(name),
})

const children = (node: unknown, name: string): XmlNode[] =>
  node && typeof node === 'object' ? (((node as Record<string, unknown>)[name] as XmlNode[] | undefined) ?? []) : []

export interface KeymapParseOptions {
  /** KeymapImpl.readExternal skips INSERT keystrokes of bundled keymaps on macOS. */
  skipInsertKeystrokes: boolean
}

export function parseKeymapXml(xml: string, options: KeymapParseOptions): KeymapDefinition {
  const doc = parser.parse(xml) as { keymap?: XmlNode }
  const root = doc.keymap
  const name = root && attr(root, 'name')
  if (!root || !name) throw new Error('Not a keymap XML')
  const actions = new Map<string, Shortcut[]>()
  for (const action of children(root, 'action')) {
    const id = attr(action, 'id')
    if (!id) continue
    const shortcuts: Shortcut[] = []
    for (const k of children(action, 'keyboard-shortcut')) {
      const first = attr(k, 'first-keystroke')
      if (!first || (options.skipInsertKeystrokes && first.includes('INSERT'))) continue
      const shortcut = keyboardShortcut(first, attr(k, 'second-keystroke'))
      if (shortcut) shortcuts.push(shortcut)
    }
    for (const g of children(action, 'keyboard-gesture-shortcut')) {
      const keystroke = attr(g, 'keystroke')
      const modifier = attr(g, 'modifier')
      const shortcut = keystroke && modifier ? gestureShortcut(keystroke, modifier) : null
      if (shortcut) shortcuts.push(shortcut)
    }
    for (const m of children(action, 'mouse-shortcut')) {
      const keystroke = attr(m, 'keystroke')
      const shortcut = keystroke ? mouseShortcut(keystroke) : null
      if (shortcut) shortcuts.push(shortcut)
    }
    actions.set(id, shortcuts)
  }
  return { name, parent: attr(root, 'parent'), actions }
}

function* walkActions(node: unknown): Generator<XmlNode> {
  if (!node || typeof node !== 'object') return
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const list = Array.isArray(value) ? value : [value]
    for (const item of list) {
      if (key === 'action' && item && typeof item === 'object') yield item as XmlNode
      if (item && typeof item === 'object') yield* walkActions(item)
    }
  }
}

/** Extracts keymap operations and bindings from a plugin descriptor (plugin.xml and its includes). */
export function parsePluginShortcuts(xml: string, into: PluginShortcuts = emptyPluginShortcuts()): PluginShortcuts {
  const doc = parser.parse(xml) as unknown
  for (const action of walkActions(doc)) {
    const actionId = attr(action, 'id')
    if (!actionId) continue
    const bound = attr(action, 'use-shortcut-of')
    if (bound) into.bindings.set(actionId, bound)
    const keyboard = (k: XmlNode): Shortcut | null => {
      const first = attr(k, 'first-keystroke')
      return first ? keyboardShortcut(first, attr(k, 'second-keystroke')) : null
    }
    const mouse = (m: XmlNode): Shortcut | null => {
      const keystroke = attr(m, 'keystroke')
      return keystroke ? mouseShortcut(keystroke) : null
    }
    const declarations: [XmlNode, Shortcut | null][] = [
      ...children(action, 'keyboard-shortcut').map((k): [XmlNode, Shortcut | null] => [k, keyboard(k)]),
      ...children(action, 'mouse-shortcut').map((m): [XmlNode, Shortcut | null] => [m, mouse(m)]),
    ]
    for (const [element, shortcut] of declarations) {
      const keymap = attr(element, 'keymap')
      if (!keymap || !shortcut) continue
      const list = into.operations.get(keymap) ?? []
      // KeymapShortcutOperation.processRemoveAndReplace
      const remove = attr(element, 'remove') === 'true'
      if (remove) list.push({ kind: 'remove', actionId, shortcut })
      if (attr(element, 'replace-all') === 'true') list.push({ kind: 'removeAll', actionId })
      if (!remove) list.push({ kind: 'add', actionId, shortcut })
      into.operations.set(keymap, list)
    }
  }
  return into
}

export function emptyPluginShortcuts(): PluginShortcuts {
  return { operations: new Map(), bindings: new Map() }
}
