// Keystrokes in the Swing `KeyStroke.getKeyStroke(String)` format used by IntelliJ keymap XMLs,
// e.g. "meta shift O", "control alt L", "alt F12", "shift SHIFT".

export const SHIFT = 1
export const CONTROL = 2
export const META = 4
export const ALT = 8

export interface KeyStroke {
  /** Bit set of SHIFT | CONTROL | META | ALT. */
  modifiers: number
  /** Java virtual key name without the VK_ prefix: "O", "F12", "SLASH", "BACK_SPACE"... */
  key: string
}

const MODIFIER_WORDS: Record<string, number> = {
  shift: SHIFT,
  control: CONTROL,
  ctrl: CONTROL,
  meta: META,
  alt: ALT,
}

// Words Swing accepts that do not change the stroke.
const IGNORED_WORDS = new Set(['pressed', 'released', 'typed', 'altGraph', 'button1', 'button2', 'button3'])

export function parseKeyStroke(text: string): KeyStroke | null {
  const words = text.trim().split(/\s+/)
  let modifiers = 0
  let key: string | null = null
  for (const word of words) {
    const modifier = MODIFIER_WORDS[word]
    if (modifier !== undefined) modifiers |= modifier
    else if (!IGNORED_WORDS.has(word)) key = word.toUpperCase()
  }
  return key ? { modifiers, key } : null
}

/** Canonical text form, stable for use as a map key: "control alt shift meta KEY". */
export function formatKeyStroke(stroke: KeyStroke): string {
  const words: string[] = []
  if (stroke.modifiers & CONTROL) words.push('control')
  if (stroke.modifiers & ALT) words.push('alt')
  if (stroke.modifiers & SHIFT) words.push('shift')
  if (stroke.modifiers & META) words.push('meta')
  words.push(stroke.key)
  return words.join(' ')
}

export function sameStroke(a: KeyStroke, b: KeyStroke): boolean {
  return a.modifiers === b.modifiers && a.key === b.key
}

/**
 * The control <-> meta swap MacOSDefaultKeymap applies to shortcuts inherited from "$default"
 * (intellij-community MacOSDefaultKeymap.mapModifiers).
 */
export function swapControlMeta(modifiers: number): number {
  let result = modifiers & ~(CONTROL | META)
  if (modifiers & CONTROL) result |= META
  if (modifiers & META) result |= CONTROL
  return result
}

const MODIFIER_KEYS: Record<string, number> = {
  SHIFT: SHIFT,
  CONTROL: CONTROL,
  META: META,
  ALT: ALT,
}

/** Modifier bit for a modifier key name ("SHIFT", "CONTROL"...), 0 for other keys. */
export function modifierOfKey(key: string): number {
  return MODIFIER_KEYS[key] ?? 0
}

// KeyboardEvent.code -> Java VK name. Physical keys, so shortcuts do not move with the layout.
const CODE_TO_KEY: Record<string, string> = {
  Backquote: 'BACK_QUOTE',
  Minus: 'MINUS',
  Equal: 'EQUALS',
  BracketLeft: 'OPEN_BRACKET',
  BracketRight: 'CLOSE_BRACKET',
  Backslash: 'BACK_SLASH',
  IntlBackslash: 'BACK_QUOTE',
  Semicolon: 'SEMICOLON',
  Quote: 'QUOTE',
  Comma: 'COMMA',
  Period: 'PERIOD',
  Slash: 'SLASH',
  Space: 'SPACE',
  Enter: 'ENTER',
  NumpadEnter: 'ENTER',
  Tab: 'TAB',
  Backspace: 'BACK_SPACE',
  Delete: 'DELETE',
  Insert: 'INSERT',
  Escape: 'ESCAPE',
  Home: 'HOME',
  End: 'END',
  PageUp: 'PAGE_UP',
  PageDown: 'PAGE_DOWN',
  ArrowUp: 'UP',
  ArrowDown: 'DOWN',
  ArrowLeft: 'LEFT',
  ArrowRight: 'RIGHT',
  NumpadDivide: 'DIVIDE',
  NumpadMultiply: 'MULTIPLY',
  NumpadSubtract: 'SUBTRACT',
  NumpadAdd: 'ADD',
  NumpadDecimal: 'DECIMAL',
  ShiftLeft: 'SHIFT',
  ShiftRight: 'SHIFT',
  ControlLeft: 'CONTROL',
  ControlRight: 'CONTROL',
  MetaLeft: 'META',
  MetaRight: 'META',
  AltLeft: 'ALT',
  AltRight: 'ALT',
  ContextMenu: 'CONTEXT_MENU',
}

export function keyFromCode(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^Numpad[0-9]$/.test(code)) return `NUMPAD${code.slice(6)}`
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code
  return CODE_TO_KEY[code] ?? null
}

export interface KeyEventLike {
  code: string
  shiftKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
}

export function modifiersOf(event: KeyEventLike): number {
  return (
    (event.shiftKey ? SHIFT : 0) | (event.ctrlKey ? CONTROL : 0) | (event.metaKey ? META : 0) | (event.altKey ? ALT : 0)
  )
}

/** Stroke for a keydown; modifier-only presses return the modifier key itself ("shift SHIFT"). */
export function strokeFromEvent(event: KeyEventLike): KeyStroke | null {
  const key = keyFromCode(event.code)
  return key ? { modifiers: modifiersOf(event), key } : null
}

const MAC_KEY_SYMBOLS: Record<string, string> = {
  ENTER: '↩',
  BACK_SPACE: '⌫',
  DELETE: '⌦',
  ESCAPE: '⎋',
  TAB: '⇥',
  SPACE: 'Space',
  UP: '↑',
  DOWN: '↓',
  LEFT: '←',
  RIGHT: '→',
  HOME: '↖',
  END: '↘',
  PAGE_UP: '⇞',
  PAGE_DOWN: '⇟',
  SLASH: '/',
  BACK_SLASH: '\\',
  COMMA: ',',
  PERIOD: '.',
  SEMICOLON: ';',
  QUOTE: "'",
  BACK_QUOTE: '`',
  MINUS: '-',
  EQUALS: '=',
  OPEN_BRACKET: '[',
  CLOSE_BRACKET: ']',
  DIVIDE: 'NumPad /',
  MULTIPLY: 'NumPad *',
  SUBTRACT: 'NumPad -',
  ADD: 'NumPad +',
  SHIFT: '⇧',
  CONTROL: '⌃',
  META: '⌘',
  ALT: '⌥',
}

/** macOS presentation in the system order ⌃⌥⇧⌘, e.g. "⇧⌘O". */
export function macLabel(stroke: KeyStroke): string {
  const prefix =
    (stroke.modifiers & CONTROL ? '⌃' : '') +
    (stroke.modifiers & ALT ? '⌥' : '') +
    (stroke.modifiers & SHIFT ? '⇧' : '') +
    (stroke.modifiers & META ? '⌘' : '')
  return prefix + (MAC_KEY_SYMBOLS[stroke.key] ?? stroke.key)
}
