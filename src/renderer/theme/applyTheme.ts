import { loadIslandsDark, loadIslandsDarkScheme } from './islandsDark'
import { cssVariables, type ResolvedTheme } from './uiTheme'

/** VCS file status colors live in the editor scheme (FILESTATUS_*), as in IntelliJ. */
const FILE_STATUS_COLORS: readonly [cssName: string, schemeKey: string][] = [
  ['modified', 'FILESTATUS_MODIFIED'],
  ['added', 'FILESTATUS_ADDED'],
  ['deleted', 'FILESTATUS_DELETED'],
  ['renamed', 'FILESTATUS_RENAMED'],
  ['untracked', 'FILESTATUS_UNKNOWN'],
  ['conflicted', 'FILESTATUS_IDEA_FILESTATUS_MERGED_WITH_CONFLICTS'],
]

/** Resolves Islands Dark and publishes every token as a CSS custom property on :root. */
export function applyIslandsDark(root: HTMLElement = document.documentElement): ResolvedTheme {
  const theme = loadIslandsDark()
  for (const [name, value] of Object.entries(cssVariables(theme))) root.style.setProperty(name, value)
  const scheme = loadIslandsDarkScheme()
  for (const [name, key] of FILE_STATUS_COLORS) {
    const color = scheme.color(key)
    if (color) root.style.setProperty(`--filestatus-${name}`, color)
  }
  root.dataset.theme = 'islands-dark'
  root.style.colorScheme = 'dark'
  return theme
}
