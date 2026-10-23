import { join } from 'node:path'
import type { RunConfigurationSpec } from '@shared/runConfigurations'
import { handle } from '../ipc'
import { hasMvnOnPath, resolveDependencies } from '../maven/dependencies'
import { mavenCommand, readReactor } from '../maven/pom'
import { assertInsideProject } from '../project'
import { runCommand } from './command'
import { packageManager } from './detect'
import { RunConfigurationStore } from './store'

const shell = (): string => process.env.SHELL ?? '/bin/zsh'

export function registerRunHandlers(dataDir: string): void {
  const store = new RunConfigurationStore(dataDir)
  handle('run:configurations', (root) => store.list(assertInsideProject(root)))
  handle('run:save', (root, spec, asProjectFile) => store.save(assertInsideProject(root), spec, asProjectFile))
  handle('run:delete', (root, id) => store.remove(assertInsideProject(root), id))
  handle('run:command', async (root, spec: RunConfigurationSpec) => {
    const projectRoot = assertInsideProject(root)
    const cwd = spec.workingDirectory ? join(projectRoot, spec.workingDirectory) : projectRoot
    return runCommand(spec, {
      root: projectRoot,
      reactor: readReactor(projectRoot),
      maven: mavenCommand(projectRoot, await hasMvnOnPath(shell())),
      packageManager: await packageManager(cwd),
      gradle: 'gradle',
    })
  })
  handle('maven:modules', (root) => readReactor(assertInsideProject(root)))
  handle('maven:dependencies', (root) => resolveDependencies(assertInsideProject(root), shell()))
}
