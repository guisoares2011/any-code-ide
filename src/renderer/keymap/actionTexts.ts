// Action presentation texts from the IntelliJ message bundles.
import actionsBundle from '@intellij/platform/platform-resources-en/src/messages/ActionsBundle.properties?raw'
import terminalBundle from '@intellij/plugins/terminal/resources/messages/TerminalBundle.properties?raw'

/** Java .properties parser: continuation lines, \uXXXX escapes, "=" or ":" separators. */
export function parseProperties(source: string): Map<string, string> {
  const result = new Map<string, string>()
  const lines = source.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]!.trimStart()
    if (line === '' || line.startsWith('#') || line.startsWith('!')) continue
    while (/(^|[^\\])(\\\\)*\\$/.test(line) && i + 1 < lines.length) {
      line = line.slice(0, -1) + lines[++i]!.trimStart()
    }
    const separator = line.search(/(?<!\\)[=:]/)
    if (separator < 0) continue
    const key = line.slice(0, separator).trim()
    const value = line
      .slice(separator + 1)
      .trimStart()
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\(.)/g, (_, ch: string) => (ch === 'n' ? '\n' : ch === 't' ? '\t' : ch))
    result.set(key, value)
  }
  return result
}

const bundles = [parseProperties(actionsBundle), parseProperties(terminalBundle)]

function lookup(key: string): string | undefined {
  for (const bundle of bundles) {
    const value = bundle.get(key)
    if (value !== undefined) return value
  }
  return undefined
}

/** Removes mnemonic markers: "_Close Tab" -> "Close Tab", "Find in Files&..." -> "Find in Files...". */
export function stripMnemonic(text: string): string {
  return text.replace(/_(?=\S)/, '').replace(/&(?=\S)/, '')
}

export function actionText(actionId: string): string | undefined {
  const text = lookup(`action.${actionId}.text`) ?? lookup(`group.${actionId}.text`)
  return text === undefined ? undefined : stripMnemonic(text)
}

export function actionDescription(actionId: string): string | undefined {
  return lookup(`action.${actionId}.description`)
}
