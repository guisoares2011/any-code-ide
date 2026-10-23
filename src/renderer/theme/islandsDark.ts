// Islands Dark, loaded from the IntelliJ Platform data files in resources/intellij-community.
import darcula from '@intellij/platform/platform-resources/src/themes/darcula.theme.json'
import experimentalDark from '@intellij/platform/platform-resources/src/themes/expUI/expUI_dark.theme.json'
import islandsDark from '@intellij/platform/platform-resources/src/themes/islands/ManyIslandsDark.theme.json'
import islandSchemeXml from '@intellij/platform/platform-resources/src/themes/islands/IslandSchemeDark.xml?raw'
import bundledSchemesXml from '@intellij/platform/platform-resources/src/DefaultColorSchemesManager.xml?raw'
import { parseBundledSchemes, parseScheme, SchemeChain } from './editorScheme'
import { resolveTheme, type ResolvedTheme, type ThemeJson } from './uiTheme'

/** Theme chain, child first: Islands Dark -> ExperimentalDark -> Darcula. */
export const ISLANDS_DARK_CHAIN: readonly ThemeJson[] = [islandsDark, experimentalDark, darcula] as ThemeJson[]

export function loadIslandsDark(): ResolvedTheme {
  return resolveTheme(ISLANDS_DARK_CHAIN)
}

/** Editor scheme chain, child first: Islands Dark -> Darcula. */
export function loadIslandsDarkScheme(): SchemeChain {
  const islands = parseScheme(islandSchemeXml)
  const bundled = parseBundledSchemes(bundledSchemesXml)
  const chain = [islands]
  for (let parentName = islands.parent; parentName; ) {
    const parent = bundled.find((scheme) => scheme.name === parentName)
    if (!parent) break
    chain.push(parent)
    parentName = parent.parent
  }
  return new SchemeChain(chain)
}
