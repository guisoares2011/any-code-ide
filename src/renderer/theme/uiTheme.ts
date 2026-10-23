// Resolves IntelliJ *.theme.json files (child first, then parents) into flat tokens.
// Named colors resolve through the child's `colors` map first, then each parent's; `ui` keys are
// flattened with "." and merged with child precedence. Mirrors scripts/reference/resolve_theme.py.

export interface ThemeJson {
  name?: string
  dark?: boolean
  parentTheme?: string
  editorScheme?: string
  colors?: Record<string, string>
  ui?: ThemeUiNode
}

export interface ThemeUiNode {
  [key: string]: ThemeUiValue
}

export type ThemeUiValue = string | number | boolean | ThemeUiNode

export interface ResolvedTheme {
  name: string
  /** Named colors (palette, layers and semantic tokens) resolved to #RRGGBB or #RRGGBBAA. */
  colors: Record<string, string>
  /** Flattened `ui` keys whose value is a color, resolved to hex. */
  uiColors: Record<string, string>
  /** Flattened `ui` keys with numeric values (arcs, widths, heights, alphas). */
  uiNumbers: Record<string, number>
}

const HEX = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

function flatten(node: ThemeUiNode, prefix: string, out: Map<string, string | number | boolean>): void {
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === 'object') flatten(value, `${prefix}${key}.`, out)
    else out.set(`${prefix}${key}`, value)
  }
}

export function resolveTheme(childFirst: readonly ThemeJson[]): ResolvedTheme {
  const named = new Map<string, string>()
  for (const theme of [...childFirst].reverse()) {
    for (const [name, value] of Object.entries(theme.colors ?? {})) named.set(name, value)
  }

  const resolveColor = (value: string, seen: ReadonlySet<string> = new Set()): string | null => {
    if (HEX.test(value)) return value.toUpperCase()
    const next = named.get(value)
    if (next === undefined || seen.has(value)) return null
    return resolveColor(next, new Set([...seen, value]))
  }

  const colors: Record<string, string> = {}
  for (const name of named.keys()) {
    const hex = resolveColor(name)
    if (hex) colors[name] = hex
  }

  const ui = new Map<string, string | number | boolean>()
  for (const theme of [...childFirst].reverse()) flatten(theme.ui ?? {}, '', ui)

  const uiColors: Record<string, string> = {}
  const uiNumbers: Record<string, number> = {}
  for (const [key, value] of ui) {
    if (typeof value === 'number') uiNumbers[key] = value
    else if (typeof value === 'string') {
      const hex = resolveColor(value)
      if (hex) uiColors[key] = hex
      else if (/^-?\d+(\.\d+)?$/.test(value)) uiNumbers[key] = Number(value)
    }
  }

  return { name: childFirst[0]?.name ?? 'unknown', colors, uiColors, uiNumbers }
}

/** CSS custom property name for a named color: `--c-<name>`. */
export const colorVar = (name: string): string => `--c-${name}`

/** CSS custom property name for a ui key: `--ui-<Key.with.dots>` with dots as dashes. */
export const uiVar = (key: string): string => `--ui-${key.replaceAll('.', '-')}`

/** Declarations for every resolved token, ready to be set on :root. */
export function cssVariables(theme: ResolvedTheme): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const [name, hex] of Object.entries(theme.colors)) vars[colorVar(name)] = hex
  for (const [key, hex] of Object.entries(theme.uiColors)) vars[uiVar(key)] = hex
  for (const [key, value] of Object.entries(theme.uiNumbers)) vars[uiVar(key)] = String(value)
  return vars
}
