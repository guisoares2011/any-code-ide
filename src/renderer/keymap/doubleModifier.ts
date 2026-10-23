// Bare modifier double-click detection (e.g. double Shift), ported from the timings of
// intellij-community ModifierKeyDoubleClickHandler: press, release, press, release of the same
// modifier, at most 300 ms apart; ignored right after another key (< 100 ms); fires on the
// second release.
import { modifierOfKey } from './keystroke'

export interface ModifierKeyEvent {
  type: 'keydown' | 'keyup'
  /** VK name of the key: "SHIFT", "CONTROL", "A"... */
  key: string
  /** Bit set of modifiers held during the event. */
  modifiers: number
  /** Event time in milliseconds. */
  time: number
}

const MAX_GAP_MS = 300
const MAX_SEQUENCE_MS = 500
const OTHER_KEY_GUARD_MS = 100

export class DoubleModifierDetector {
  private firstPressed = false
  private firstReleased = false
  private secondPressed = false
  private otherKeyWasPressed = false
  private lastTime = 0

  /** @param modifierKey VK name of the modifier to watch, e.g. "SHIFT". */
  constructor(private readonly modifierKey: string) {}

  /** Feeds one key event; returns true when this event completes a double click. */
  feed(event: ModifierKeyEvent): boolean {
    if (event.key === this.modifierKey) {
      const ownBit = modifierOfKey(this.modifierKey)
      if ((event.modifiers & ~ownBit) !== 0) {
        this.reset()
        return false
      }
      if (this.otherKeyWasPressed && event.time - this.lastTime < OTHER_KEY_GUARD_MS) {
        this.reset()
        return false
      }
      this.otherKeyWasPressed = false
      if (this.firstPressed && event.time - this.lastTime > MAX_SEQUENCE_MS) this.reset()
      return this.handleModifier(event)
    }
    // Any other key, other modifiers included, breaks the sequence.
    this.lastTime = event.time
    this.otherKeyWasPressed = true
    if (event.key === 'ESCAPE' || event.key === 'TAB') this.lastTime = 0
    this.reset()
    return false
  }

  private handleModifier(event: ModifierKeyEvent): boolean {
    if (this.firstPressed && event.time - this.lastTime > MAX_GAP_MS) {
      this.reset()
      return false
    }
    if (event.type === 'keydown') {
      if (!this.firstPressed) {
        this.reset()
        this.firstPressed = true
        this.lastTime = event.time
      } else if (this.firstReleased) {
        this.secondPressed = true
        this.lastTime = event.time
      }
      return false
    }
    if (this.firstPressed && !this.firstReleased) {
      this.firstReleased = true
      this.lastTime = event.time
      return false
    }
    if (this.firstPressed && this.firstReleased && this.secondPressed) {
      this.reset()
      return true
    }
    return false
  }

  private reset(): void {
    this.firstPressed = false
    this.firstReleased = false
    this.secondPressed = false
  }
}
