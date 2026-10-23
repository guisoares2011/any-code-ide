import { formatKeyStroke, macLabel, parseKeyStroke, sameStroke, swapControlMeta, type KeyStroke } from './keystroke'

export interface KeyboardShortcut {
  type: 'keyboard'
  first: KeyStroke
  second?: KeyStroke
}

export interface MouseShortcut {
  type: 'mouse'
  modifiers: number
  /** 1 = primary, 2 = middle, 3 = secondary. */
  button: number
  clickCount: number
}

export interface GestureShortcut {
  type: 'gesture'
  /** Modifier double-click uses the modifier key itself as the stroke: "shift SHIFT". */
  stroke: KeyStroke
  modifier: 'dblClick' | 'hold'
}

export type Shortcut = KeyboardShortcut | MouseShortcut | GestureShortcut

export function keyboardShortcut(first: string, second?: string): KeyboardShortcut | null {
  const firstStroke = parseKeyStroke(first)
  if (!firstStroke) return null
  if (second === undefined) return { type: 'keyboard', first: firstStroke }
  const secondStroke = parseKeyStroke(second)
  return secondStroke ? { type: 'keyboard', first: firstStroke, second: secondStroke } : null
}

/** IntelliJ KeymapUtil.parseMouseShortcut format: "[modifiers] button<N> [doubleClick]". */
export function mouseShortcut(text: string): MouseShortcut | null {
  const words = text.trim().split(/\s+/)
  const button = words.map((w) => /^button(\d)$/.exec(w)?.[1]).find((b) => b !== undefined)
  if (!button) return null
  const stroke = parseKeyStroke(words.filter((w) => !/^button\d$/.test(w) && w !== 'doubleClick').concat('X').join(' '))
  return {
    type: 'mouse',
    modifiers: stroke?.modifiers ?? 0,
    button: Number(button),
    clickCount: words.includes('doubleClick') ? 2 : 1,
  }
}

export function gestureShortcut(keystroke: string, modifier: string): GestureShortcut | null {
  const stroke = parseKeyStroke(keystroke)
  if (!stroke || (modifier !== 'dblClick' && modifier !== 'hold')) return null
  return { type: 'gesture', stroke, modifier }
}

export function sameShortcut(a: Shortcut, b: Shortcut): boolean {
  if (a.type === 'keyboard' && b.type === 'keyboard') {
    if (!sameStroke(a.first, b.first)) return false
    return a.second && b.second ? sameStroke(a.second, b.second) : a.second === b.second
  }
  if (a.type === 'mouse' && b.type === 'mouse') {
    return a.modifiers === b.modifiers && a.button === b.button && a.clickCount === b.clickCount
  }
  if (a.type === 'gesture' && b.type === 'gesture') return a.modifier === b.modifier && sameStroke(a.stroke, b.stroke)
  return false
}

/**
 * MacOSDefaultKeymap.convertShortcutFromParent: control <-> meta on keyboard and mouse shortcuts.
 * Gestures pass unchanged: KeyboardModifierGestureShortcut is not a KeyboardShortcut, so double ⌃
 * stays double ⌃ on macOS.
 */
export function convertFromParent(shortcut: Shortcut): Shortcut {
  const swap = (stroke: KeyStroke): KeyStroke => ({ ...stroke, modifiers: swapControlMeta(stroke.modifiers) })
  switch (shortcut.type) {
    case 'keyboard':
      return shortcut.second
        ? { type: 'keyboard', first: swap(shortcut.first), second: swap(shortcut.second) }
        : { type: 'keyboard', first: swap(shortcut.first) }
    case 'mouse':
      return { ...shortcut, modifiers: swapControlMeta(shortcut.modifiers) }
    case 'gesture':
      return shortcut
  }
}

export function formatShortcut(shortcut: Shortcut): string {
  switch (shortcut.type) {
    case 'keyboard':
      return shortcut.second
        ? `${formatKeyStroke(shortcut.first)}, ${formatKeyStroke(shortcut.second)}`
        : formatKeyStroke(shortcut.first)
    case 'mouse':
      return `${formatKeyStroke({ modifiers: shortcut.modifiers, key: `button${shortcut.button}` })}${shortcut.clickCount > 1 ? ' doubleClick' : ''}`
    case 'gesture':
      return `${shortcut.modifier} ${formatKeyStroke(shortcut.stroke)}`
  }
}

/** Label for menus and tooltips on macOS: "⇧⌘O", "⌘K, ⌘S", "⇧⇧". */
export function shortcutLabel(shortcut: Shortcut): string {
  switch (shortcut.type) {
    case 'keyboard':
      return shortcut.second ? `${macLabel(shortcut.first)}, ${macLabel(shortcut.second)}` : macLabel(shortcut.first)
    case 'mouse':
      return `${macLabel({ modifiers: shortcut.modifiers, key: '' })}Click`
    case 'gesture':
      // "shift SHIFT" already reads as the double press: ⇧⇧.
      return macLabel(shortcut.stroke)
  }
}
