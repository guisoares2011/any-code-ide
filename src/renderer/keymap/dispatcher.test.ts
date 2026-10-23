import { describe, expect, it, vi } from 'vitest'
import { ActionRegistry, type FocusArea } from './actions'
import { KeymapDispatcher, type DispatchEvent } from './dispatcher'
import { DoubleModifierDetector } from './doubleModifier'
import { Keymap } from './keymap'
import { loadMacKeymap } from './macKeymap'
import { keyboardShortcut } from './shortcut'

function keyEvent(type: 'keydown' | 'keyup', code: string, time: number, mods: Partial<DispatchEvent> = {}): DispatchEvent {
  return { type, code, timeStamp: time, repeat: false, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...mods }
}

function setup(focus: FocusArea = 'editor', keymap: Keymap = loadMacKeymap()) {
  const registry = new ActionRegistry()
  let area = focus
  const dispatcher = new KeymapDispatcher(() => keymap, registry, () => area)
  return { registry, dispatcher, setFocus: (next: FocusArea) => (area = next) }
}

describe('KeymapDispatcher', () => {
  it('runs single-stroke actions from the real macOS keymap', () => {
    const { registry, dispatcher } = setup()
    const perform = vi.fn()
    registry.register({ id: 'GotoFile', perform })
    expect(dispatcher.dispatch(keyEvent('keydown', 'KeyO', 0, { metaKey: true, shiftKey: true }))).toBe(true)
    expect(perform).toHaveBeenCalledOnce()
    expect(dispatcher.dispatch(keyEvent('keydown', 'KeyO', 10, { metaKey: true }))).toBe(false)
  })

  it('skips disabled actions so the next candidate or the component gets the key', () => {
    const { registry, dispatcher } = setup()
    const replace = vi.fn()
    const rerun = vi.fn()
    registry.register({ id: 'Replace', perform: replace, isEnabled: (c) => c.focusArea === 'editor' })
    registry.register({ id: 'Rerun', perform: rerun, isEnabled: (c) => c.focusArea === 'run' })
    dispatcher.dispatch(keyEvent('keydown', 'KeyR', 0, { metaKey: true }))
    expect(replace).toHaveBeenCalledOnce()
    expect(rerun).not.toHaveBeenCalled()
  })

  it('waits for the second stroke of a chord', () => {
    const keymap = new Keymap('Custom', null, new Map([['Chord', [keyboardShortcut('meta K', 'meta S')!]]]))
    const { registry, dispatcher } = setup('editor', keymap)
    const perform = vi.fn()
    registry.register({ id: 'Chord', perform })
    expect(dispatcher.dispatch(keyEvent('keydown', 'KeyK', 0, { metaKey: true }))).toBe(true)
    expect(perform).not.toHaveBeenCalled()
    expect(dispatcher.dispatch(keyEvent('keydown', 'KeyS', 100, { metaKey: true }))).toBe(true)
    expect(perform).toHaveBeenCalledOnce()
  })

  it('passes keys to the terminal unless the action is on the allowed list', () => {
    const { registry, dispatcher } = setup('terminal')
    const reformat = vi.fn()
    const gotoFile = vi.fn()
    registry.register({ id: 'ReformatCode', perform: reformat })
    registry.register({ id: 'GotoFile', perform: gotoFile })
    expect(dispatcher.dispatch(keyEvent('keydown', 'KeyL', 0, { metaKey: true, altKey: true }))).toBe(false)
    expect(reformat).not.toHaveBeenCalled()
    expect(dispatcher.dispatch(keyEvent('keydown', 'KeyO', 10, { metaKey: true, shiftKey: true }))).toBe(true)
    expect(gotoFile).toHaveBeenCalledOnce()
  })

  it('opens Search Everywhere on double Shift', () => {
    const { registry, dispatcher } = setup()
    const perform = vi.fn()
    registry.register({ id: 'SearchEverywhere', perform })
    dispatcher.dispatch(keyEvent('keydown', 'ShiftLeft', 0, { shiftKey: true }))
    dispatcher.dispatch(keyEvent('keyup', 'ShiftLeft', 80))
    dispatcher.dispatch(keyEvent('keydown', 'ShiftLeft', 160, { shiftKey: true }))
    expect(perform).not.toHaveBeenCalled()
    expect(dispatcher.dispatch(keyEvent('keyup', 'ShiftLeft', 240))).toBe(true)
    expect(perform).toHaveBeenCalledOnce()
  })
})

describe('DoubleModifierDetector', () => {
  const press = (d: DoubleModifierDetector, type: 'keydown' | 'keyup', key: string, time: number, modifiers = 0) =>
    d.feed({ type, key, time, modifiers })

  it('rejects slow sequences', () => {
    const d = new DoubleModifierDetector('SHIFT')
    press(d, 'keydown', 'SHIFT', 0, 1)
    press(d, 'keyup', 'SHIFT', 100)
    press(d, 'keydown', 'SHIFT', 450, 1)
    expect(press(d, 'keyup', 'SHIFT', 500)).toBe(false)
  })

  it('ignores Shift right after typing (shifted letters)', () => {
    const d = new DoubleModifierDetector('SHIFT')
    press(d, 'keydown', 'A', 0)
    press(d, 'keydown', 'SHIFT', 50, 1)
    press(d, 'keyup', 'SHIFT', 100)
    press(d, 'keydown', 'SHIFT', 150, 1)
    expect(press(d, 'keyup', 'SHIFT', 200)).toBe(false)
  })

  it('does not fire when another modifier is held', () => {
    const d = new DoubleModifierDetector('SHIFT')
    press(d, 'keydown', 'SHIFT', 0, 1 | 4)
    press(d, 'keyup', 'SHIFT', 50, 4)
    press(d, 'keydown', 'SHIFT', 100, 1 | 4)
    expect(press(d, 'keyup', 'SHIFT', 150, 4)).toBe(false)
  })
})

describe('ActionRegistry', () => {
  it('runs the most recent enabled handler of an id', () => {
    const registry = new ActionRegistry()
    const editor = vi.fn()
    const terminal = vi.fn()
    registry.register({ id: 'NextTab', perform: editor, isEnabled: (c) => c.focusArea === 'editor' })
    const unregister = registry.register({ id: 'NextTab', perform: terminal, isEnabled: (c) => c.focusArea === 'terminal' })
    registry.perform('NextTab', { focusArea: 'editor' })
    registry.perform('NextTab', { focusArea: 'terminal' })
    expect(editor).toHaveBeenCalledOnce()
    expect(terminal).toHaveBeenCalledOnce()
    unregister()
    expect(registry.perform('NextTab', { focusArea: 'terminal' })).toBe(false)
  })
})
