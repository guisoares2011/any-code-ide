import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { RunConfigurationSpec } from '@shared/runConfigurations'
import { handle } from '../ipc'
import { hasMvnOnPath, resolveDependencies } from '../maven/dependencies'
import { mavenCommand, readReactor } from '../maven/pom'
import { assertInsideProject } from '../project'
import { userShell } from '../settings'
import { runCommand } from './command'
import { packageManager } from './detect'
import { RunConfigurationStore } from './store'

const shell = userShell

/** Gradle build files at the root and no pom.xml: tests run with Gradle. */
const usesGradle = (root: string): boolean =>
  !existsSync(join(root, 'pom.xml')) &&
  ['gradlew', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts'].some((file) => existsSync(join(root, file)))

export function registerRunHandlers(dataDir: string): void {
  const store = new RunConfigurationStore(dataDir)
  handle('run:configurations', (root) => store.list(assertInsideProject(root)))
  handle('run:save', (root, spec, asProjectFile) => store.save(assertInsideProject(root), spec, asProjectFile))
  handle('run:delete', (root, id) => store.remove(assertInsideProject(root), id))
  handle('run:command', async (root, spec: RunConfigurationSpec, debug) => {
    const projectRoot = assertInsideProject(root)
    const cwd = spec.workingDirectory ? join(projectRoot, spec.workingDirectory) : projectRoot
    return runCommand(spec, {
      root: projectRoot,
      reactor: readReactor(projectRoot),
      maven: mavenCommand(projectRoot, await hasMvnOnPath(shell())),
      packageManager: await packageManager(cwd),
      gradle: existsSync(join(projectRoot, 'gradlew')) ? './gradlew' : 'gradle',
      usesGradle: usesGradle(projectRoot),
    }, debug)
  })
  handle('maven:modules', (root) => readReactor(assertInsideProject(root)))
  handle('maven:dependencies', (root) => resolveDependencies(assertInsideProject(root), shell()))
}
