// Editor/preview layout of Markdown files (TextEditorWithPreview.Layout in IntelliJ), per file.
import { basename } from '@shared/paths'
import { createStore } from '../state/store'

export type MarkdownLayout = 'editor' | 'split' | 'preview'

export const markdownLayouts = createStore<{ byPath: Record<string, MarkdownLayout> }>({ byPath: {} })

export function isMarkdownFile(path: string): boolean {
  return /\.(md|markdown)$/i.test(path)
}

/** READMEs open as rendered documents; other Markdown files side by side, IntelliJ's default. */
export function layoutOf(path: string, byPath: Record<string, MarkdownLayout> = markdownLayouts.get().byPath): MarkdownLayout {
  return byPath[path] ?? (/^readme\b/i.test(basename(path)) ? 'preview' : 'split')
}

export function setMarkdownLayout(path: string, layout: MarkdownLayout): void {
  markdownLayouts.set((s) => ({ byPath: { ...s.byPath, [path]: layout } }))
}

export const LAYOUT_ACTIONS: readonly { id: string; text: string; layout: MarkdownLayout; icon: string }[] = [
  { id: 'TextEditorWithPreview.Layout.EditorOnly', text: 'Editor Only', layout: 'editor', icon: 'general/editorOnly' },
  { id: 'TextEditorWithPreview.Layout.EditorAndPreview', text: 'Editor and Preview', layout: 'split', icon: 'general/editorPreview' },
  { id: 'TextEditorWithPreview.Layout.PreviewOnly', text: 'Preview Only', layout: 'preview', icon: 'general/previewOnly' },
]
