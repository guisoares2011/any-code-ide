// Run configurations derived from the project itself (not stored): package.json scripts, Gradle
// tasks, and a Spring Boot configuration per @SpringBootApplication class, like IntelliJ creates.
import { access, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { MavenModule } from '@shared/maven'
import type { RunConfigurationSpec } from '@shared/runConfigurations'

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  )

/** Package manager from the lockfile present in a directory; npm when there is none. */
export async function packageManager(dir: string): Promise<'npm' | 'pnpm' | 'yarn' | 'bun'> {
  if (await exists(join(dir, 'pnpm-lock.yaml'))) return 'pnpm'
  if (await exists(join(dir, 'yarn.lock'))) return 'yarn'
  if ((await exists(join(dir, 'bun.lockb'))) || (await exists(join(dir, 'bun.lock')))) return 'bun'
  return 'npm'
}

const base = { origin: 'detected' as const, env: {}, workingDirectory: '' }

async function npmScripts(root: string): Promise<RunConfigurationSpec[]> {
  try {
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { scripts?: Record<string, unknown> }
    return Object.entries(manifest.scripts ?? {})
      .filter(([, command]) => typeof command === 'string')
      .map(([script]) => ({ ...base, id: `npm:${script}`, name: script, type: 'npm' as const, script, arguments: '' }))
  } catch {
    return []
  }
}

async function gradleTasks(root: string): Promise<RunConfigurationSpec[]> {
  const isGradle = (await exists(join(root, 'gradlew'))) || (await exists(join(root, 'build.gradle.kts'))) || (await exists(join(root, 'build.gradle')))
  if (!isGradle) return []
  return ['build', 'test', 'run'].map((task) => ({ ...base, id: `gradle:${task}`, name: `gradle ${task}`, type: 'gradle' as const, tasks: task }))
}

const MAX_SCANNED_FILES = 5000

/** Main classes annotated with @SpringBootApplication in each Maven module's main sources. */
export async function springBootApplications(root: string, reactor: readonly MavenModule[]): Promise<RunConfigurationSpec[]> {
  const result: RunConfigurationSpec[] = []
  let scanned = 0
  for (const module of reactor) {
    for (const lang of ['java', 'kotlin']) {
      const sourceRoot = join(root, module.directory, 'src', 'main', lang)
      const stack = [sourceRoot]
      while (stack.length > 0 && scanned < MAX_SCANNED_FILES) {
        const dir = stack.pop()!
        let entries
        try {
          entries = await readdir(dir, { withFileTypes: true })
        } catch {
          continue
        }
        for (const entry of entries) {
          const path = join(dir, entry.name)
          if (entry.isDirectory()) stack.push(path)
          else if (/\.(java|kt)$/.test(entry.name)) {
            scanned++
            const source = await readFile(path, 'utf8')
            if (!source.includes('@SpringBootApplication')) continue
            const className = path.slice(sourceRoot.length + 1).replace(/\.(java|kt)$/, '').replaceAll('/', '.')
            const simpleName = className.split('.').pop()!
            result.push({
              ...base,
              id: `spring-boot:${className}`,
              name: simpleName,
              type: 'spring-boot',
              mainClass: className,
              module: module.directory,
              activeProfiles: '',
              vmOptions: '',
              programArguments: '',
            })
          }
        }
      }
    }
  }
  return result
}

export async function detectRunConfigurations(root: string, reactor: readonly MavenModule[]): Promise<RunConfigurationSpec[]> {
  const groups = await Promise.all([springBootApplications(root, reactor), npmScripts(root), gradleTasks(root)])
  return groups.flat()
}
