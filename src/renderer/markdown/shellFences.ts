// Runnable shell code blocks in Markdown, like IntelliJ's Markdown plugin
// (MarkdownRunLineMarkersProvider / CommandRunnerExtension.trimPrompt).
import MarkdownIt from 'markdown-it'

const SHELL_LANGUAGES = new Set(['bash', 'sh', 'shell', 'zsh', 'console', 'terminal', 'shell-session', 'shellscript', 'fish'])

export interface ShellFence {
  /** 0-based line of the opening ``` fence. */
  startLine: number
  /** 0-based line after the closing fence. */
  endLine: number
  language: string
  /** The commands to run (prompts and trailing comments removed). */
  command: string
}

export function isShellLanguage(info: string): boolean {
  return SHELL_LANGUAGES.has(info.trim().split(/\s+/)[0]?.toLowerCase() ?? '')
}

/** Removes a trailing `# comment` that is outside quotes. */
export function stripTrailingComment(line: string): string {
  let single = false
  let double = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '\\') {
      i++
      continue
    }
    if (ch === "'" && !double) single = !single
    else if (ch === '"' && !single) double = !double
    else if (ch === '#' && !single && !double && (i === 0 || /\s/.test(line[i - 1]!))) return line.slice(0, i).trimEnd()
  }
  return line
}

/**
 * Commands of a block: when some lines start with a `$` prompt (a console transcript), only those
 * lines run and the rest is treated as output; otherwise every line runs. Prompts, trailing
 * comments and empty lines are dropped.
 */
export function shellCommand(code: string): string {
  const lines = code.split('\n')
  const prompted = lines.some((line) => /^\s*\$/.test(line))
  return lines
    .filter((line) => !prompted || /^\s*\$/.test(line))
    .map((line) => stripTrailingComment(line.replace(/^\s*\$\s?/, '')).trimEnd())
    .filter((line) => line.trim() !== '')
    .join('\n')
}

// Same options as the preview renderer, so both see the same fences.
const parser = new MarkdownIt({ html: true })

/** Every shell block in document order (the preview numbers its Run buttons the same way); `command` may be empty. */
export function findShellFences(markdown: string): ShellFence[] {
  return parser
    .parse(markdown, {})
    .filter((token) => token.type === 'fence' && token.map && isShellLanguage(token.info))
    .map((token) => ({
      startLine: token.map![0],
      endLine: token.map![1],
      language: token.info.trim().split(/\s+/)[0]!.toLowerCase(),
      command: shellCommand(token.content),
    }))
}
