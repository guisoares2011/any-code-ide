import type { MavenModule } from '@shared/maven'
import { basename } from '@shared/paths'

/** How the Project view shows a directory that is a module or one of its source roots. */
export interface DirDecoration {
  icon: string
  /** Module content roots are bold in IntelliJ's Project view. */
  bold?: boolean
  /** Module name, shown as "dir [name]" when it differs from the directory name. */
  moduleName?: string
}

/** Maven's standard layout, as IntelliJ marks it after importing the pom. */
const STANDARD_ROOTS: [string, string][] = [
  ['src/main/java', 'nodes/sourceRoot'],
  ['src/main/kotlin', 'nodes/sourceRoot'],
  ['src/main/resources', 'nodes/resourcesRoot'],
  ['src/test/java', 'nodes/testRoot'],
  ['src/test/kotlin', 'nodes/testRoot'],
  ['src/test/resources', 'nodes/resourcesRoot'],
  ['target', 'nodes/excludeRoot'],
]

/** Decorations by absolute directory path for the Maven reactor rooted at `root`. */
export function mavenDecorations(root: string, modules: readonly MavenModule[]): Map<string, DirDecoration> {
  const result = new Map<string, DirDecoration>()
  for (const module of modules) {
    const dir = module.directory ? `${root}/${module.directory}` : root
    if (module.directory) {
      const name = module.artifactId && module.artifactId !== basename(module.directory) ? module.artifactId : undefined
      result.set(dir, { icon: 'nodes/module', bold: true, ...(name ? { moduleName: name } : {}) })
    }
    if (module.packaging === 'pom') continue
    for (const [relative, icon] of STANDARD_ROOTS) result.set(`${dir}/${relative}`, { icon })
  }
  return result
}
