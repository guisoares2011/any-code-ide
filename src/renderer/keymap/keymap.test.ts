import { describe, expect, it } from 'vitest'
import { Keymap } from './keymap'
import { parseKeymapXml } from './keymapXml'
import { formatKeyStroke, macLabel, parseKeyStroke, strokeFromEvent, CONTROL, META, SHIFT } from './keystroke'
import { loadMacKeymap } from './macKeymap'
import { formatShortcut, keyboardShortcut, shortcutLabel } from './shortcut'

const shortcuts = (keymap: Keymap, id: string): string[] => keymap.getShortcuts(id).map(formatShortcut)

describe('keystrokes', () => {
  it('parses the Swing format used by the XMLs', () => {
    expect(parseKeyStroke('meta shift O')).toEqual({ modifiers: META | SHIFT, key: 'O' })
    expect(parseKeyStroke('ctrl alt shift P')).toEqual(parseKeyStroke('control alt shift P'))
    expect(parseKeyStroke('shift b')?.key).toBe('B')
    expect(formatKeyStroke({ modifiers: META | SHIFT | CONTROL, key: 'A' })).toBe('control shift meta A')
  })

  it('maps physical keys from KeyboardEvent.code', () => {
    const event = { code: 'Slash', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false }
    expect(strokeFromEvent(event)).toEqual({ modifiers: META, key: 'SLASH' })
    expect(strokeFromEvent({ ...event, code: 'KeyO', shiftKey: true })).toEqual({ modifiers: META | SHIFT, key: 'O' })
    expect(strokeFromEvent({ ...event, code: 'ShiftLeft', metaKey: false, shiftKey: true })).toEqual({
      modifiers: SHIFT,
      key: 'SHIFT',
    })
  })

  it('labels strokes in macOS order', () => {
    expect(macLabel({ modifiers: META | SHIFT, key: 'O' })).toBe('⇧⌘O')
    expect(macLabel(parseKeyStroke('control alt O')!)).toBe('⌃⌥O')
  })
})

describe('Keymap resolution (synthetic)', () => {
  const parent = new Keymap(
    '$default',
    null,
    new Map([
      ['A', [keyboardShortcut('control A')!]],
      ['B', [keyboardShortcut('control B')!]],
    ]),
  )

  it('swaps control and meta for shortcuts inherited by a "Mac OS X" keymap', () => {
    const mac = new Keymap('Mac OS X 10.5+', parent, new Map())
    expect(shortcuts(mac, 'A')).toEqual(['meta A'])
    const other = new Keymap('Custom', parent, new Map())
    expect(shortcuts(other, 'A')).toEqual(['control A'])
  })

  it('lets an own entry, even an empty one, replace the parent', () => {
    const mac = new Keymap('Mac OS X 10.5+', parent, new Map([['B', []]]))
    expect(shortcuts(mac, 'B')).toEqual([])
  })

  it('follows use-shortcut-of bindings', () => {
    const mac = new Keymap('Mac OS X 10.5+', parent, new Map(), (id) => (id === 'C' ? 'A' : undefined))
    expect(shortcuts(mac, 'C')).toEqual(['meta A'])
  })

  it('applies plugin operations on top of inherited shortcuts', () => {
    const mac = new Keymap('Mac OS X 10.5+', parent, new Map())
    mac.apply([{ kind: 'add', actionId: 'A', shortcut: keyboardShortcut('meta K')! }])
    expect(shortcuts(mac, 'A')).toEqual(['meta A', 'meta K'])
    mac.apply([
      { kind: 'removeAll', actionId: 'B' },
      { kind: 'add', actionId: 'B', shortcut: keyboardShortcut('control C')! },
    ])
    expect(shortcuts(mac, 'B')).toEqual(['control C'])
  })

  it('rejects a mismatched parent', () => {
    const definition = parseKeymapXml('<keymap name="X" parent="Y"/>', { skipInsertKeystrokes: true })
    expect(() => Keymap.fromDefinition(definition, parent)).toThrow()
  })
})

describe('macOS keymap from the IntelliJ 2026.1 XMLs', () => {
  const keymap = loadMacKeymap()

  // Spot-check of docs/reverse-engineering.md (K1-K9).
  it.each([
    ['GotoFile', 'shift meta O'],
    ['GotoAction', 'shift meta A'],
    ['ReformatCode', 'alt meta L'],
    ['OptimizeImports', 'control alt O'],
    ['GotoDeclaration', 'meta B'],
    ['CommentByLineComment', 'meta SLASH'],
    ['Vcs.QuickListPopupAction', 'control V'],
    ['Switcher', 'control TAB'],
    ['ActivateProjectToolWindow', 'meta 1'],
    ['ActivateCommitToolWindow', 'meta 0'],
    ['ActivateTerminalToolWindow', 'alt F12'],
    ['ShowSettings', 'meta COMMA'],
    ['Terminal.NewTab', 'meta T'],
    ['Terminal.ClearBuffer', 'meta K'],
    ['Run', 'control R'],
    ['Stop', 'meta F2'],
    ['Rerun', 'meta R'],
    ['ChooseRunConfiguration', 'control alt R'],
    ['ActivateRunToolWindow', 'meta 4'],
    ['CheckinProject', 'meta K'],
    ['Vcs.Push', 'shift meta K'],
    ['Diff.ShowDiff', 'meta D'],
    ['ChangesView.Revert', 'alt meta Z'],
    ['ActivateVersionControlToolWindow', 'meta 9'],
    ['Vcs.Log.FocusTextFilter', 'meta L'],
    ['Vcs.CopyRevisionNumberAction', 'alt shift meta C'],
    ['RunClass', 'control shift R'],
    ['EditorDuplicate', 'meta D'],
    ['GotoLine', 'meta L'],
    ['SaveAll', 'meta S'],
    ['CloseContent', 'meta W'],
    ['RecentFiles', 'meta E'],
    ['HideAllWindows', 'shift meta F12'],
    ['SearchEverywhere.NextTab', 'TAB'],
    ['Terminal.CopySelectedText', 'meta C'],
    ['Terminal.Paste', 'meta V'],
    // Project view: context menu actions and scratch files.
    ['NewElement', 'meta N'],
    ['NewScratchFile', 'shift meta N'],
    ['RenameElement', 'shift F6'],
    ['$Delete', 'BACK_SPACE'],
    ['$Cut', 'meta X'],
    ['$Copy', 'meta C'],
    ['$Paste', 'meta V'],
    ['CopyPaths', 'shift meta C'],
    // Debugger.
    ['Debug', 'control D'],
    ['DebugClass', 'control shift D'],
    ['ActivateDebugToolWindow', 'meta 5'],
    ['ToggleLineBreakpoint', 'meta F8'],
    ['ViewBreakpoints', 'shift meta F8'],
    ['Resume', 'alt meta R'],
    ['Resume', 'F9'],
    ['StepOver', 'F8'],
    ['StepInto', 'F7'],
    ['SmartStepInto', 'shift F7'],
    ['StepOut', 'shift F8'],
    ['RunToCursor', 'alt F9'],
    ['EvaluateExpression', 'alt F8'],
    ['ShowExecutionPoint', 'alt F10'],
    ['Console.Execute', 'ENTER'],
    // Editor font size (⌘+wheel is the editor's own behavior, not a keymap entry).
    ['EditorIncreaseFontSizeGlobal', 'control shift PERIOD'],
    ['EditorDecreaseFontSizeGlobal', 'control shift COMMA'],
    // Component-level shortcuts (componentShortcuts.ts), converted like other $default entries.
    ['List-selectNextColumn', 'RIGHT'],
    ['List-selectPreviousColumn', 'LEFT'],
    ['Commit.Execute', 'meta ENTER'],
    ['Tree-selectNext', 'DOWN'],
    ['EditSourceOnEnter', 'ENTER'],
    ['Popup.Cancel', 'ESCAPE'],
  ])('%s is bound to %s', (actionId, expected) => {
    expect(shortcuts(keymap, actionId)).toContain(expected)
  })

  it('lets the terminal plugin replace ClearPrompt with control C only', () => {
    expect(shortcuts(keymap, 'Terminal.ClearPrompt')).toEqual(['control C'])
  })

  it('declares the double-Shift and double-Ctrl gestures, unswapped on macOS', () => {
    expect(keymap.getShortcuts('SearchEverywhere').map(shortcutLabel)).toContain('⇧⇧')
    expect(shortcuts(keymap, 'RunAnything')).toContain('dblClick control CONTROL')
  })

  it('maps IntelliJ 2026.1 mouse shortcuts (K7)', () => {
    expect(shortcuts(keymap, 'EditorAddOrRemoveCaret')).toEqual(['alt shift button1'])
  })
})
