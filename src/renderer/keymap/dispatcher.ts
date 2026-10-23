// Turns key events into actions using the active keymap, like IntelliJ's IdeKeyEventDispatcher:
// single-stroke shortcuts run immediately, two-stroke shortcuts wait for the second stroke, and
// bare modifier double clicks (double Shift) go through DoubleModifierDetector. When the terminal
// has focus, only TERMINAL_ALLOWED_ACTION_IDS are intercepted; every other key reaches the process.
import type { ActionContext, ActionRegistry, FocusArea } from './actions'
import { DoubleModifierDetector } from './doubleModifier'
import type { Keymap } from './keymap'
import { formatKeyStroke, modifierOfKey, strokeFromEvent, type KeyEventLike, type KeyStroke } from './keystroke'
import type { KeyboardShortcut } from './shortcut'
import { TERMINAL_ALLOWED_ACTION_IDS } from './terminalAllowedActions'

export interface DispatchEvent extends KeyEventLike {
  type: 'keydown' | 'keyup'
  repeat: boolean
  timeStamp: number
}

interface Candidate {
  actionId: string
  shortcut: KeyboardShortcut
}

const CHORD_TIMEOUT_MS = 2500

export class KeymapDispatcher {
  private index = new Map<string, Candidate[]>()
  private gestures = new Map<string, string[]>()
  private detectors = new Map<string, DoubleModifierDetector>()
  private indexedVersion = -1
  private pending: { first: KeyStroke; candidates: Candidate[]; until: number } | null = null

  constructor(
    private readonly keymap: () => Keymap,
    private readonly registry: ActionRegistry,
    private readonly focusArea: () => FocusArea,
  ) {}

  /** Rebuilds the stroke index; call after switching keymaps. */
  invalidate(): void {
    this.indexedVersion = -1
  }

  /** Returns true when the event was consumed by an action (caller prevents default). */
  dispatch(event: DispatchEvent): boolean {
    this.ensureIndex()
    const stroke = strokeFromEvent(event)
    if (!stroke) return false
    const context: ActionContext = { focusArea: this.focusArea() }

    if (!event.repeat && this.dispatchGesture(event, stroke, context)) return true
    if (event.type !== 'keydown' || modifierOfKey(stroke.key) !== 0) return false

    if (this.pending) {
      const pending = this.pending
      this.pending = null
      if (event.timeStamp <= pending.until) {
        const second = pending.candidates.filter(
          (c) => c.shortcut.second && formatKeyStroke(c.shortcut.second) === formatKeyStroke(stroke),
        )
        if (this.performFirst(second, context)) return true
      }
    }

    const candidates = this.allowed(this.index.get(formatKeyStroke(stroke)) ?? [], context)
    if (this.performFirst(candidates.filter((c) => !c.shortcut.second), context)) return true
    const chords = candidates.filter((c) => c.shortcut.second && this.registry.isEnabled(c.actionId, context))
    if (chords.length > 0) {
      this.pending = { first: stroke, candidates: chords, until: event.timeStamp + CHORD_TIMEOUT_MS }
      return true
    }
    return false
  }

  /** Shortcut candidates the dispatcher would consider for a stroke, for tests and UI hints. */
  candidatesFor(stroke: KeyStroke): string[] {
    this.ensureIndex()
    return (this.index.get(formatKeyStroke(stroke)) ?? []).map((c) => c.actionId)
  }

  private dispatchGesture(event: DispatchEvent, stroke: KeyStroke, context: ActionContext): boolean {
    let fired = false
    for (const [modifierKey, detector] of this.detectors) {
      const completed = detector.feed({
        type: event.type,
        key: stroke.key,
        modifiers: event.type === 'keyup' ? stroke.modifiers & ~modifierOfKey(stroke.key) : stroke.modifiers,
        time: event.timeStamp,
      })
      if (completed) {
        for (const actionId of this.gestures.get(modifierKey) ?? []) {
          if (this.registry.perform(actionId, context)) {
            fired = true
            break
          }
        }
      }
    }
    return fired
  }

  private allowed(candidates: Candidate[], context: ActionContext): Candidate[] {
    if (context.focusArea !== 'terminal') return candidates
    return candidates.filter((c) => TERMINAL_ALLOWED_ACTION_IDS.has(c.actionId))
  }

  private performFirst(candidates: Candidate[], context: ActionContext): boolean {
    return candidates.some((candidate) => this.registry.perform(candidate.actionId, context))
  }

  private ensureIndex(): void {
    if (this.indexedVersion === this.registry.version) return
    const keymap = this.keymap()
    const index = new Map<string, Candidate[]>()
    const gestures = new Map<string, string[]>()
    for (const action of this.registry.all()) {
      for (const shortcut of keymap.getShortcuts(action.id)) {
        if (shortcut.type === 'keyboard') {
          const key = formatKeyStroke(shortcut.first)
          index.set(key, [...(index.get(key) ?? []), { actionId: action.id, shortcut }])
        } else if (shortcut.type === 'gesture' && shortcut.modifier === 'dblClick') {
          // Only bare double clicks: the stroke's modifiers are the modifier key itself.
          const bare = (shortcut.stroke.modifiers & ~modifierOfKey(shortcut.stroke.key)) === 0
          if (bare && modifierOfKey(shortcut.stroke.key) !== 0) {
            gestures.set(shortcut.stroke.key, [...(gestures.get(shortcut.stroke.key) ?? []), action.id])
          }
        }
      }
    }
    this.index = index
    this.gestures = gestures
    for (const key of gestures.keys()) {
      if (!this.detectors.has(key)) this.detectors.set(key, new DoubleModifierDetector(key))
    }
    for (const key of [...this.detectors.keys()]) {
      if (!gestures.has(key)) this.detectors.delete(key)
    }
    this.indexedVersion = this.registry.version
  }
}
