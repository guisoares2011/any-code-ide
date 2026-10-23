import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import CssWorker from 'monaco-editor/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker'
import JsonWorker from 'monaco-editor/language/json/json.worker?worker'
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker'
import { loadIslandsDarkScheme } from '../theme/islandsDark'
import { monacoThemeFromScheme } from '../theme/monacoTheme'

export const THEME_NAME = 'islands-dark'

let initialized = false

export function setupMonaco(): typeof monaco {
  if (initialized) return monaco
  initialized = true

  self.MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      switch (label) {
        case 'json':
          return new JsonWorker()
        case 'css':
        case 'scss':
        case 'less':
          return new CssWorker()
        case 'html':
        case 'handlebars':
        case 'razor':
          return new HtmlWorker()
        case 'typescript':
        case 'javascript':
          return new TsWorker()
        default:
          return new EditorWorker()
      }
    },
  }

  monaco.editor.defineTheme(THEME_NAME, monacoThemeFromScheme(loadIslandsDarkScheme()))

  // Without the project's tsconfig and node_modules the built-in TS service reports false errors
  // on every import; keep syntax checks only until the real language server (roadmap item 5).
  for (const defaults of [monaco.typescript.typescriptDefaults, monaco.typescript.javascriptDefaults]) {
    defaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false })
    defaults.setCompilerOptions({
      target: monaco.typescript.ScriptTarget.ESNext,
      module: monaco.typescript.ModuleKind.ESNext,
      jsx: monaco.typescript.JsxEmit.ReactJSX,
      allowJs: true,
      allowNonTsExtensions: true,
    })
  }
  return monaco
}

/** Monaco language id for a file name, from the registered languages' extensions and file names. */
export function languageForFile(fileName: string): string {
  const lower = fileName.toLowerCase()
  for (const language of monaco.languages.getLanguages()) {
    if (language.filenames?.some((name) => name.toLowerCase() === lower)) return language.id
  }
  for (const language of monaco.languages.getLanguages()) {
    if (language.extensions?.some((ext) => lower.endsWith(ext.toLowerCase()))) return language.id
  }
  return 'plaintext'
}
