// Settings that change open editors and terminals in place.
import * as monaco from 'monaco-editor'
import { setEslintEnabled } from '../lint/eslint'
import { editorFont, followSettings, loadSettings } from '../state/settings'
import { setTerminalFontSize } from '../terminal/ptySessions'

export async function installSettings(): Promise<void> {
  await loadSettings()
  followSettings(
    (s) => s.editor,
    () => {
      const font = editorFont()
      for (const editor of monaco.editor.getEditors()) editor.updateOptions(font)
      for (const diff of monaco.editor.getDiffEditors()) diff.updateOptions(font)
    },
  )
  followSettings((s) => s.terminal.fontSize, setTerminalFontSize)
  followSettings((s) => s.eslint.enabled, setEslintEnabled)
}
