// IntelliJ editor actions mapped onto Monaco commands. Shortcuts come from the keymap; Monaco only
// executes. Actions not listed here fall through to Monaco's own handling (typing, undo, copy...).
import type { editor } from 'monaco-editor'
import type { ActionDefinition } from '../keymap/actions'
import { showToolWindow } from '../state/workbench'

const EDITOR_COMMANDS: readonly [actionId: string, monacoCommand: string][] = [
  ['EditorDuplicate', 'editor.action.duplicateSelection'],
  ['EditorDeleteLine', 'editor.action.deleteLines'],
  ['CommentByLineComment', 'editor.action.commentLine'],
  ['CommentByBlockComment', 'editor.action.blockComment'],
  ['MoveLineUp', 'editor.action.moveLinesUpAction'],
  ['MoveLineDown', 'editor.action.moveLinesDownAction'],
  ['MoveStatementUp', 'editor.action.moveLinesUpAction'],
  ['MoveStatementDown', 'editor.action.moveLinesDownAction'],
  ['EditorSelectWord', 'editor.action.smartSelect.expand'],
  ['EditorUnSelectWord', 'editor.action.smartSelect.shrink'],
  ['ReformatCode', 'editor.action.formatDocument'],
  ['GotoLine', 'editor.action.gotoLine'],
  ['Find', 'actions.find'],
  ['Replace', 'editor.action.startFindReplaceAction'],
  ['FindNext', 'editor.action.nextMatchFindAction'],
  ['FindPrevious', 'editor.action.previousMatchFindAction'],
  ['GotoDeclaration', 'editor.action.revealDefinition'],
  ['EditorToggleCase', 'editor.action.transformToUppercase'],
  ['EditorJoinLines', 'editor.action.joinLines'],
  ['EditorStartNewLine', 'editor.action.insertLineAfter'],
  ['EditorStartNewLineBefore', 'editor.action.insertLineBefore'],
  ['CollapseRegion', 'editor.fold'],
  ['ExpandRegion', 'editor.unfold'],
  ['CollapseAllRegions', 'editor.foldAll'],
  ['ExpandAllRegions', 'editor.unfoldAll'],
]

export function editorActions(getEditor: () => editor.IStandaloneCodeEditor | null): ActionDefinition[] {
  return EDITOR_COMMANDS.map(([id, command]) => ({
    id,
    isEnabled: (context) => context.focusArea === 'editor' && getEditor()?.getModel() != null,
    perform: () => {
      const instance = getEditor()
      if (!instance) return
      instance.focus()
      instance.trigger('keymap', command, null)
    },
  }))
}

/**
 * AnyCode's own action (no IntelliJ equivalent): sends the file and selected lines to Claude Code as
 * an @-mention and focuses the terminal. No default shortcut: ⌥⌘K, used by the official
 * integrations, is Commit and Push in the IntelliJ macOS keymap.
 */
export function sendSelectionToClaude(getEditor: () => editor.IStandaloneCodeEditor | null): ActionDefinition {
  return {
    id: 'AnyCode.SendSelectionToClaude',
    text: 'Send Selection to Claude',
    isEnabled: (context) => context.focusArea === 'editor' && getEditor()?.getModel() != null,
    perform: () => {
      const instance = getEditor()
      const model = instance?.getModel()
      const selection = instance?.getSelection()
      if (!model || !selection) return
      window.anycode.send('bridge:atMentioned', {
        filePath: model.uri.fsPath,
        lineStart: selection.startLineNumber - 1,
        lineEnd: selection.endLineNumber - 1,
      })
      showToolWindow('Terminal')
    },
  }
}

export const EDITOR_ACTION_IDS: readonly string[] = EDITOR_COMMANDS.map(([id]) => id)
