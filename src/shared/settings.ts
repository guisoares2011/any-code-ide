// User settings (Settings dialog, ⌘,), stored as <userData>/settings.json.

export type MarkdownDefaultLayout = 'auto' | 'editor' | 'split' | 'preview'

export interface Settings {
  editor: {
    fontSize: number
    /** Line height in px. */
    lineHeight: number
  }
  terminal: {
    fontSize: number
    /** Shell for terminals and run configurations; "" uses $SHELL. */
    shell: string
    /** Command of the agent tab opened with each project; "" opens a plain shell. */
    agentCommand: string
  }
  eslint: {
    enabled: boolean
  }
  markdown: {
    /** auto: READMEs open as the preview, other files side by side. */
    defaultLayout: MarkdownDefaultLayout
  }
}

export const DEFAULT_SETTINGS: Settings = {
  editor: { fontSize: 13, lineHeight: 20 },
  terminal: { fontSize: 13, shell: '', agentCommand: 'claude' },
  eslint: { enabled: true },
  markdown: { defaultLayout: 'auto' },
}

export const FONT_SIZE_RANGE = { min: 8, max: 32 } as const
export const LINE_HEIGHT_RANGE = { min: 10, max: 60 } as const

const LAYOUTS: readonly MarkdownDefaultLayout[] = ['auto', 'editor', 'split', 'preview']

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

function number(value: unknown, fallback: number, range: { min: number; max: number }): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(Math.max(Math.round(value), range.min), range.max) : fallback
}

const text = (value: unknown, fallback: string): string => (typeof value === 'string' ? value.trim() : fallback)

/** Settings from untrusted JSON (a hand-edited file, an older version): unknown keys dropped, values clamped. */
export function normalizeSettings(input: unknown): Settings {
  const root = isObject(input) ? input : {}
  const section = (name: string): Record<string, unknown> => (isObject(root[name]) ? root[name] : {})
  const editor = section('editor')
  const terminal = section('terminal')
  const eslint = section('eslint')
  const markdown = section('markdown')
  const d = DEFAULT_SETTINGS
  return {
    editor: {
      fontSize: number(editor.fontSize, d.editor.fontSize, FONT_SIZE_RANGE),
      lineHeight: number(editor.lineHeight, d.editor.lineHeight, LINE_HEIGHT_RANGE),
    },
    terminal: {
      fontSize: number(terminal.fontSize, d.terminal.fontSize, FONT_SIZE_RANGE),
      shell: text(terminal.shell, d.terminal.shell),
      agentCommand: text(terminal.agentCommand, d.terminal.agentCommand),
    },
    eslint: { enabled: typeof eslint.enabled === 'boolean' ? eslint.enabled : d.eslint.enabled },
    markdown: {
      defaultLayout: LAYOUTS.includes(markdown.defaultLayout as MarkdownDefaultLayout) ? (markdown.defaultLayout as MarkdownDefaultLayout) : d.markdown.defaultLayout,
    },
  }
}
