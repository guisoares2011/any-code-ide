import { describe, expect, it } from 'vitest'
import { loadIslandsDark, loadIslandsDarkScheme } from './islandsDark'
import { monacoThemeFromScheme } from './monacoTheme'
import { cssVariables, resolveTheme } from './uiTheme'

describe('resolveTheme', () => {
  it('resolves named colors through the child-first chain', () => {
    const theme = resolveTheme([
      { name: 'child', colors: { accent: 'blue', panel: '#111111' }, ui: { Button: { background: 'accent', arc: 8 } } },
      { name: 'parent', colors: { blue: '#0000ff', accent: 'red' }, ui: { Button: { foreground: 'panel' } } },
    ])
    expect(theme.colors.accent).toBe('#0000FF')
    expect(theme.uiColors['Button.background']).toBe('#0000FF')
    expect(theme.uiColors['Button.foreground']).toBe('#111111')
    expect(theme.uiNumbers['Button.arc']).toBe(8)
  })

  it('ignores reference cycles', () => {
    const theme = resolveTheme([{ colors: { a: 'b', b: 'a' } }])
    expect(theme.colors.a).toBeUndefined()
  })
})

describe('Islands Dark (IntelliJ 2026.1 data)', () => {
  const theme = loadIslandsDark()

  it('matches the surfaces recorded in docs/reverse-engineering.md (T5)', () => {
    expect(theme.name).toBe('Islands Dark')
    expect(theme.colors['container-main-window-bg']).toBe('#26282C')
    expect(theme.colors['container-tool-window-bg']).toBe('#191A1C')
    expect(theme.colors['container-editor-bg']).toBe('#191A1C')
    expect(theme.colors['text-default']).toBe('#D1D3D9')
    expect(theme.colors['text-muted']).toBe('#9FA2A8')
    expect(theme.colors['selection-bg-active']).toBe('#2A4371')
    expect(theme.colors['accent-brand-bg']).toBe('#3871E1')
  })

  it('keeps the island geometry (T4)', () => {
    expect(theme.uiNumbers['Island.arc']).toBe(20)
    expect(theme.uiNumbers['Island.borderWidth']).toBe(6)
    expect(theme.uiNumbers['EditorTabs.underlineHeight']).toBe(4)
    expect(theme.uiNumbers['List.rowHeight']).toBe(24)
  })

  it('emits CSS variables for colors and ui keys', () => {
    const vars = cssVariables(theme)
    expect(vars['--c-container-main-window-bg']).toBe('#26282C')
    expect(vars['--ui-MainToolbar-background']).toBe('#26282C')
    expect(vars['--ui-Island-arc']).toBe('20')
  })
})

describe('Islands Dark editor scheme', () => {
  const scheme = loadIslandsDarkScheme()

  it('resolves attributes from the scheme and its Darcula parent', () => {
    expect(scheme.attributes('TEXT')).toMatchObject({ foreground: '#BCBEC4', background: '#191A1C' })
    expect(scheme.attributes('DEFAULT_KEYWORD')?.foreground).toBe('#CF8E6D')
    expect(scheme.attributes('DEFAULT_STRING')?.foreground).toBe('#6AAB73')
    expect(scheme.color('CARET_ROW_COLOR')).toBe('#1F2024')
  })

  it('produces a Monaco theme', () => {
    const monaco = monacoThemeFromScheme(scheme)
    expect(monaco.colors['editor.background']).toBe('#191A1C')
    expect(monaco.rules).toContainEqual({ token: 'keyword', foreground: 'CF8E6D' })
    expect(monaco.rules.find((r) => r.token === 'comment.doc')?.fontStyle).toBe('italic')
  })
})

describe('terminal theme', () => {
  it('maps console attributes to ANSI colors', async () => {
    const { terminalThemeFromScheme } = await import('./terminalTheme')
    const theme = terminalThemeFromScheme(loadIslandsDarkScheme(), '#191A1C')
    expect(theme.background).toBe('#191A1C')
    for (const slot of ['red', 'green', 'blue', 'brightWhite'] as const) expect(theme[slot]).toMatch(/^#[0-9A-F]{6}/)
  })
})
