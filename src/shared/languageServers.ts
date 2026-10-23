// Language servers AnyCode runs, and which documents each one owns.

export type LanguageServerId = 'typescript' | 'java' | 'kotlin'

export interface LanguageServerSpec {
  id: LanguageServerId
  name: string
  /** Monaco language ids whose documents this server receives. */
  monacoLanguages: readonly string[]
  /** LSP languageId to send for a file extension (the server picks the script kind from it). */
  languageIdByExtension: Readonly<Record<string, string>>
}

export const LANGUAGE_SERVERS: readonly LanguageServerSpec[] = [
  {
    id: 'typescript',
    name: 'TypeScript (typescript-go)',
    monacoLanguages: ['typescript', 'javascript'],
    languageIdByExtension: {
      '.ts': 'typescript',
      '.mts': 'typescript',
      '.cts': 'typescript',
      '.tsx': 'typescriptreact',
      '.js': 'javascript',
      '.mjs': 'javascript',
      '.cjs': 'javascript',
      '.jsx': 'javascriptreact',
    },
  },
  {
    id: 'java',
    name: 'Java (Eclipse JDT LS)',
    monacoLanguages: ['java'],
    languageIdByExtension: { '.java': 'java' },
  },
  {
    id: 'kotlin',
    name: 'Kotlin (JetBrains kotlin-lsp)',
    monacoLanguages: ['kotlin'],
    languageIdByExtension: { '.kt': 'kotlin', '.kts': 'kotlin' },
  },
]

/** LSP languageId of a file for a server, or null when the server does not own it. */
export function lspLanguageId(spec: LanguageServerSpec, path: string): string | null {
  const dot = path.lastIndexOf('.')
  if (dot < 0 || dot < path.lastIndexOf('/')) return null
  return spec.languageIdByExtension[path.slice(dot).toLowerCase()] ?? null
}
