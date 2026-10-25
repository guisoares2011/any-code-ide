// Component-level shortcuts. IntelliJ registers tree/list navigation actions (Tree-selectNext,
// List-selectNextRow...; see PlatformActions.xml) with the keystrokes of Swing's InputMaps
// (BasicTreeUI/BasicListUI), not in the keymap XMLs. AnyCode adds the same defaults to "$default"
// so components never read raw keys. Popup.Cancel/Popup.Confirm stand in for the Escape/Enter
// handling of IntelliJ popups, EditSourceOnEnter for the project view's
// EditSourceOnEnterKeyHandler and Commit.Execute for the commit message's ⌘⏎
// (CommonShortcuts.getCtrlEnter); none of them has an action id there. These are "$default"
// entries, so "control" becomes ⌘ on macOS.
export const COMPONENT_SHORTCUTS: readonly [actionId: string, keystrokes: readonly string[]][] = [
  ['Tree-selectPrevious', ['UP']],
  ['Tree-selectNext', ['DOWN']],
  ['Tree-selectParent', ['LEFT']],
  ['Tree-selectChild', ['RIGHT']],
  ['Tree-selectFirst', ['HOME']],
  ['Tree-selectLast', ['END']],
  ['EditSourceOnEnter', ['ENTER']],
  ['List-selectPreviousRow', ['UP']],
  ['List-selectNextRow', ['DOWN']],
  // Context menus: → opens a submenu, ← goes back to its parent.
  ['List-selectNextColumn', ['RIGHT']],
  ['List-selectPreviousColumn', ['LEFT']],
  ['Commit.Execute', ['control ENTER']],
  ['Popup.Cancel', ['ESCAPE']],
  ['Popup.Confirm', ['ENTER']],
]
