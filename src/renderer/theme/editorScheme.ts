// Parses IntelliJ editor color schemes (*.xml) and resolves attributes through
// `baseAttributes` and the `parent_scheme` chain.
import { XMLParser } from 'fast-xml-parser'

export interface TextAttributes {
  foreground?: string
  background?: string
  effectColor?: string
  errorStripeColor?: string
  /** IntelliJ font type bit set: 1 = bold, 2 = italic. */
  fontType?: number
  effectType?: number
}

export interface EditorScheme {
  name: string
  parent?: string
  colors: Record<string, string>
  attributes: Record<string, TextAttributes | { base: string }>
}

interface RawOption {
  name: string
  /** An attribute for colors (`value="..."`), a nested element for text attributes. */
  value?: string | { option?: RawOption[] }
  baseAttributes?: string
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  isArray: (name) => name === 'option' || name === 'scheme',
})

/** IntelliJ stores colors as hex without "#", sometimes shortened ("0") or with alpha last. */
export function schemeColor(value: string | undefined): string | undefined {
  if (value === undefined || value === '') return undefined
  const hex = value.replace(/^#/, '')
  if (!/^[0-9a-fA-F]{1,8}$/.test(hex)) return undefined
  return '#' + (hex.length === 8 ? hex : hex.padStart(6, '0')).toUpperCase()
}

function toAttributes(values: RawOption[]): TextAttributes {
  const byName = new Map(values.map((v) => [v.name, typeof v.value === 'string' ? v.value : undefined]))
  const fontType = byName.get('FONT_TYPE')
  const effectType = byName.get('EFFECT_TYPE')
  return {
    foreground: schemeColor(byName.get('FOREGROUND')),
    background: schemeColor(byName.get('BACKGROUND')),
    effectColor: schemeColor(byName.get('EFFECT_COLOR')),
    errorStripeColor: schemeColor(byName.get('ERROR_STRIPE_COLOR')),
    fontType: fontType ? Number(fontType) : undefined,
    effectType: effectType ? Number(effectType) : undefined,
  }
}

interface RawScheme {
  name: string
  parent_scheme?: string
  colors?: { option?: RawOption[] }
  attributes?: { option?: RawOption[] }
}

function fromRaw(raw: RawScheme): EditorScheme {
  const colors: Record<string, string> = {}
  for (const option of raw.colors?.option ?? []) {
    const color = typeof option.value === 'string' ? schemeColor(option.value) : undefined
    if (color) colors[option.name] = color
  }
  const attributes: EditorScheme['attributes'] = {}
  for (const option of raw.attributes?.option ?? []) {
    if (option.baseAttributes) attributes[option.name] = { base: option.baseAttributes }
    else attributes[option.name] = toAttributes(typeof option.value === 'object' ? (option.value.option ?? []) : [])
  }
  return { name: raw.name, parent: raw.parent_scheme, colors, attributes }
}

/** Parses a standalone scheme file (`<scheme>` root). */
export function parseScheme(xml: string): EditorScheme {
  const doc = parser.parse(xml) as { scheme: RawScheme[] }
  const raw = doc.scheme[0]
  if (!raw) throw new Error('No <scheme> element')
  return fromRaw(raw)
}

/** Parses DefaultColorSchemesManager.xml, which bundles several schemes. */
export function parseBundledSchemes(xml: string): EditorScheme[] {
  const doc = parser.parse(xml) as { component: { scheme: RawScheme[] } }
  return doc.component.scheme.map(fromRaw)
}

/** A scheme with its parents, child first, resolving attributes and colors like EditorColorsSchemeImpl. */
export class SchemeChain {
  constructor(private readonly chain: readonly EditorScheme[]) {}

  color(name: string): string | undefined {
    for (const scheme of this.chain) {
      const value = scheme.colors[name]
      if (value) return value
    }
    return undefined
  }

  attributes(name: string, depth = 0): TextAttributes | undefined {
    if (depth > 16) return undefined
    for (const scheme of this.chain) {
      const value = scheme.attributes[name]
      if (!value) continue
      return 'base' in value ? this.attributes(value.base, depth + 1) : value
    }
    return undefined
  }
}
