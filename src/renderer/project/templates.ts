// New Java and Kotlin types: where they go and what they start with.

/** Java/Kotlin source root and package of a directory: ".../src/main/java/com/acme" → "com.acme". */
export function packageOf(dir: string): { sourceRoot: string; packageName: string } | null {
  const match = /^(.*\/src\/[^/]+\/(?:java|kotlin))(\/.*)?$/.exec(dir)
  if (!match) return null
  return { sourceRoot: match[1]!, packageName: (match[2] ?? '').slice(1).replaceAll('/', '.') }
}

/** IntelliJ's default file templates for a new Java or Kotlin type. */
export function typeTemplate(language: 'java' | 'kotlin', kind: string, packageName: string, name: string): string {
  if (language === 'java') {
    const header = packageName ? `package ${packageName};\n\n` : ''
    const body = kind === 'record' ? `public record ${name}() {\n}\n` : `public ${kind} ${name} {\n}\n`
    return header + body
  }
  const header = packageName ? `package ${packageName}\n\n` : ''
  if (kind === 'file') return header
  return header + (kind === 'data class' ? `data class ${name}()\n` : `${kind} ${name} {\n}\n`)
}
