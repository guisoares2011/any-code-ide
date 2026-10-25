// "Run '<name>'" in the project view's context menu: the configuration IntelliJ's
// RunContextPopupGroup would create for the selected file or directory.
import { basename, dirname, relativePath } from '@shared/paths'
import { junitName, type JUnitConfiguration, type RunConfigurationSpec } from '@shared/runConfigurations'
import { findTests } from '../run/testDetection'
import { testConfiguration } from '../run/testSupport'
import { projectRootOf } from '../state/projects'
import { workbench } from '../state/workbench'
import type { FileTarget } from './fileActions'

const quote = (text: string): string => `'${text.replaceAll("'", `'\\''`)}'`

/** Interpreters for scripts and scratch files, by extension. */
const INTERPRETERS: Record<string, string> = {
  sh: 'bash',
  bash: 'bash',
  zsh: 'zsh',
  js: 'node',
  mjs: 'node',
  cjs: 'node',
  // Node 22.18+ strips TypeScript types itself.
  ts: 'node',
  mts: 'node',
  py: 'python3',
  rb: 'ruby',
}

/** Node scripts the debugger can start directly (js-debug's `program`). */
export const isNodeScript = (path: string): boolean => /\.(m|c)?(j|t)s$/.test(path)

/** A JUnit configuration for a test source directory: a package, or the whole module at its root. */
function directoryTests(root: string, dir: string): JUnitConfiguration | null {
  const match = /^(.*?)\/?src\/test\/(?:java|kotlin)(?:\/(.*))?$/.exec(relativePath(root, dir))
  if (!match) return null
  const module = match[1] ?? ''
  const packageName = (match[2] ?? '').replaceAll('/', '.')
  const fields = { scope: packageName ? ('package' as const) : ('module' as const), module, packageName, className: '', methodName: '' }
  const name = junitName(fields)
  return { ...fields, id: `junit:${module}:${name}`, name, type: 'junit', origin: 'detected', env: {}, workingDirectory: '', vmOptions: '' }
}

/** What Run in the context menu would start for a target, or null when nothing applies. */
export async function contextConfiguration(target: FileTarget): Promise<RunConfigurationSpec | null> {
  const root = projectRootOf(target.path) ?? workbench.get().project?.root
  if (!root) return null
  if (target.kind === 'directory') return directoryTests(root, target.path)
  const name = basename(target.path)
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''
  if (extension === 'java' || extension === 'kt') {
    const content = await window.anycode.invoke('fs:readFile', target.path).catch(() => null)
    const first = content?.kind === 'text' ? findTests(content.content).classes[0] : undefined
    return first ? testConfiguration(target.path, { scope: 'class', className: first.className, methodName: '' }) : null
  }
  const interpreter = INTERPRETERS[extension]
  if (!interpreter) return null
  return {
    id: `script:${target.path}`,
    name,
    type: 'shell',
    origin: 'detected',
    env: {},
    workingDirectory: '',
    // Scripts run where they are (scratch files live outside the project), like IntelliJ's Shell Script configurations.
    script: `cd ${quote(dirname(target.path))} && ${interpreter} ${quote(target.path)}`,
  }
}
