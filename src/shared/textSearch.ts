// Find in Files / Replace in Files: the matcher, shared by the main process (files on disk) and the
// renderer (open documents with unsaved edits, and Replace).

export interface SearchOptions {
  query: string
  caseSensitive: boolean
  wholeWords: boolean
  regex: boolean
  /** IntelliJ's "File mask": comma-separated globs, `!` excludes ("*.ts, !*.test.ts"); "" = every file. */
  fileMask: string
}

export interface SearchMatch {
  /** 1-based line and column of the match start (columns in UTF-16 units, like Monaco). */
  line: number
  column: number
  /** End of the match (1-based, exclusive column), possibly on a later line for multi-line regexes. */
  endLine: number
  endColumn: number
  /** The line of the match start, cut around the match when long. */
  preview: string
  /** The match inside `preview` (offsets, end exclusive; clipped to the line). */
  previewStart: number
  previewEnd: number
}

export interface FileMatches {
  path: string
  matches: SearchMatch[]
}

export interface SearchResult {
  files: FileMatches[]
  /** Matches across all files. */
  total: number
  /** The search stopped at the match limit. */
  truncated: boolean
  /** Invalid regular expression. */
  error?: string
}

export interface SearchRequest {
  /** Lets the main process drop a superseded search. */
  id: number
  root: string
  /** Search below this directory only ("Directory" scope); the project root when omitted. */
  directory?: string
  options: SearchOptions
}

const PREVIEW_CONTEXT = 60
const MAX_PREVIEW = 240

/** The regular expression for the options, or the error message for an invalid pattern. */
export function buildPattern(options: SearchOptions): RegExp | { error: string } {
  if (options.query === '') return { error: 'Empty query' }
  let source = options.regex ? options.query : options.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // No "u" flag: it rejects escapes like "\-" that Java's regexes (IntelliJ's) accept.
  if (options.wholeWords) source = `(?<!\\w)(?:${source})(?!\\w)`
  try {
    return new RegExp(source, `gm${options.caseSensitive ? '' : 'i'}`)
  } catch (error) {
    return { error: error instanceof Error ? error.message.replace(/^Invalid regular expression: /, '') : String(error) }
  }
}

function lineStarts(text: string): number[] {
  const starts = [0]
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) starts.push(i + 1)
  return starts
}

/** Index of the line containing `offset` (0-based). */
function lineAt(starts: readonly number[], offset: number): number {
  let low = 0
  let high = starts.length - 1
  while (low < high) {
    const mid = (low + high + 1) >> 1
    if (starts[mid]! <= offset) low = mid
    else high = mid - 1
  }
  return low
}

/** Every match of `pattern` in `text`, up to `limit`. Empty matches are skipped. */
export function findMatches(text: string, pattern: RegExp, limit = Infinity): SearchMatch[] {
  const starts = lineStarts(text)
  const matches: SearchMatch[] = []
  const regex = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)
  for (let m = regex.exec(text); m !== null && matches.length < limit; m = regex.exec(text)) {
    if (m[0].length === 0) {
      regex.lastIndex = m.index + 1
      continue
    }
    const startLine = lineAt(starts, m.index)
    const end = m.index + m[0].length
    const endLine = lineAt(starts, end)
    const lineStart = starts[startLine]!
    const lineEnd = startLine + 1 < starts.length ? starts[startLine + 1]! - 1 : text.length
    const line = text.slice(lineStart, lineEnd).replace(/\r$/, '')
    const column = m.index - lineStart
    const matchEnd = Math.min(column + m[0].length, line.length)
    // Long lines (minified code) show a window around the match.
    let from = 0
    let to = line.length
    if (line.length > MAX_PREVIEW) {
      from = Math.max(0, column - PREVIEW_CONTEXT)
      to = Math.min(line.length, Math.max(matchEnd, column) + PREVIEW_CONTEXT)
    }
    const raw = line.slice(from, to)
    const trimmed = from === 0 ? raw.replace(/^\s+/, '') : raw
    const cut = from + (raw.length - trimmed.length)
    matches.push({
      line: startLine + 1,
      column: column + 1,
      endLine: endLine + 1,
      endColumn: end - starts[endLine]! + 1,
      preview: trimmed.replace(/\s+$/, ''),
      previewStart: column - cut,
      previewEnd: matchEnd - cut,
    })
  }
  return matches
}

/**
 * The text of one match after replacement: `$1`, `$<name>` and `$&` expand in regex mode, as in
 * IntelliJ (Java's `$1`); in plain mode the replacement is literal.
 */
export function replacementFor(matched: string, pattern: RegExp, replacement: string, regex: boolean): string {
  if (!regex) return replacement
  const single = new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ''))
  return matched.replace(single, replacement)
}

/** `text` with every match replaced. */
export function replaceAll(text: string, pattern: RegExp, replacement: string, regex: boolean): string {
  const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)
  return regex ? text.replace(global, replacement) : text.replace(global, () => replacement)
}

function globToRegExp(glob: string): RegExp {
  let source = ''
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]!
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        source += '.*'
        i++
        if (glob[i + 1] === '/') i++
      } else source += '[^/]*'
    } else if (ch === '?') source += '[^/]'
    else source += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${source}$`, 'i')
}

/**
 * The file mask as a predicate on paths relative to the project root. A glob without "/" matches the
 * file name, one with "/" the relative path. Only exclusions means everything else matches.
 */
export function fileMaskFilter(mask: string): (relativePath: string) => boolean {
  const globs = mask
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean)
  if (globs.length === 0) return () => true
  const test = (glob: string) => {
    const regex = globToRegExp(glob)
    return glob.includes('/') ? (path: string) => regex.test(path) : (path: string) => regex.test(path.slice(path.lastIndexOf('/') + 1))
  }
  const include = globs.filter((g) => !g.startsWith('!')).map(test)
  const exclude = globs.filter((g) => g.startsWith('!')).map((g) => test(g.slice(1)))
  return (path) => (include.length === 0 || include.some((t) => t(path))) && !exclude.some((t) => t(path))
}
