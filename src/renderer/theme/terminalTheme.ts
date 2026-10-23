// xterm.js colors from the editor scheme's console attributes, as the IntelliJ terminal does
// (ANSI colors = CONSOLE_*_OUTPUT foregrounds).
import type { ITheme } from '@xterm/xterm'
import type { SchemeChain } from './editorScheme'

const ANSI: readonly (readonly [keyof ITheme, string])[] = [
  ['black', 'CONSOLE_BLACK_OUTPUT'],
  ['red', 'CONSOLE_RED_OUTPUT'],
  ['green', 'CONSOLE_GREEN_OUTPUT'],
  ['yellow', 'CONSOLE_YELLOW_OUTPUT'],
  ['blue', 'CONSOLE_BLUE_OUTPUT'],
  ['magenta', 'CONSOLE_MAGENTA_OUTPUT'],
  ['cyan', 'CONSOLE_CYAN_OUTPUT'],
  ['white', 'CONSOLE_GRAY_OUTPUT'],
  ['brightBlack', 'CONSOLE_DARKGRAY_OUTPUT'],
  ['brightRed', 'CONSOLE_RED_BRIGHT_OUTPUT'],
  ['brightGreen', 'CONSOLE_GREEN_BRIGHT_OUTPUT'],
  ['brightYellow', 'CONSOLE_YELLOW_BRIGHT_OUTPUT'],
  ['brightBlue', 'CONSOLE_BLUE_BRIGHT_OUTPUT'],
  ['brightMagenta', 'CONSOLE_MAGENTA_BRIGHT_OUTPUT'],
  ['brightCyan', 'CONSOLE_CYAN_BRIGHT_OUTPUT'],
  ['brightWhite', 'CONSOLE_WHITE_OUTPUT'],
]

/**
 * @param background the tool window background, so the terminal blends into its island.
 */
export function terminalThemeFromScheme(scheme: SchemeChain, background: string): ITheme {
  const text = scheme.attributes('TEXT')
  const theme: ITheme = {
    background,
    foreground: scheme.attributes('CONSOLE_NORMAL_OUTPUT')?.foreground ?? text?.foreground,
    cursor: scheme.color('CARET_COLOR'),
    cursorAccent: background,
    selectionBackground: scheme.color('SELECTION_BACKGROUND'),
  }
  for (const [slot, key] of ANSI) {
    const color = scheme.attributes(key)?.foreground
    if (color) (theme as Record<string, string>)[slot] = color
  }
  return theme
}
