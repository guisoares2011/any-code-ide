// Run configurations detected from the project root: package.json scripts, Gradle and Maven.
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { RunConfiguration } from '@shared/ipc'
import { handle } from './ipc'
import { assertInsideProject } from './project'

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  )

/** Package manager from the lockfile present in the root; npm when there is none. */
export async function packageManager(root: string): Promise<'npm' | 'pnpm' | 'yarn' | 'bun'> {
  if (await exists(join(root, 'pnpm-lock.yaml'))) return 'pnpm'
  if (await exists(join(root, 'yarn.lock'))) return 'yarn'
  if ((await exists(join(root, 'bun.lockb'))) || (await exists(join(root, 'bun.lock')))) return 'bun'
  return 'npm'
}

async function npmConfigurations(root: string): Promise<RunConfiguration[]> {
  let scripts: Record<string, unknown>
  try {
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { scripts?: Record<string, unknown> }
    scripts = manifest.scripts ?? {}
  } catch {
    return []
  }
  const manager = await packageManager(root)
  return Object.keys(scripts)
    .filter((name) => typeof scripts[name] === 'string')
    .map((name) => ({ id: `npm:${name}`, name, kind: 'npm' as const, command: [manager, 'run', name] }))
}

async function gradleConfigurations(root: string): Promise<RunConfiguration[]> {
  const wrapper = await exists(join(root, 'gradlew'))
  const buildFile = (await exists(join(root, 'build.gradle.kts'))) || (await exists(join(root, 'build.gradle')))
  if (!wrapper && !buildFile) return []
  const gradle = wrapper ? './gradlew' : 'gradle'
  return ['build', 'test', 'run'].map((task) => ({
    id: `gradle:${task}`,
    name: `gradle ${task}`,
    kind: 'gradle' as const,
    command: [gradle, task],
  }))
}

async function mavenConfigurations(root: string): Promise<RunConfiguration[]> {
  if (!(await exists(join(root, 'pom.xml')))) return []
  const maven = (await exists(join(root, 'mvnw'))) ? './mvnw' : 'mvn'
  const goals = ['package', 'test']
  const pom = await readFile(join(root, 'pom.xml'), 'utf8').catch(() => '')
  if (pom.includes('spring-boot-maven-plugin')) goals.push('spring-boot:run')
  return goals.map((goal) => ({ id: `maven:${goal}`, name: `mvn ${goal}`, kind: 'maven' as const, command: [maven, goal] }))
}

export async function detectRunConfigurations(root: string): Promise<RunConfiguration[]> {
  const groups = await Promise.all([npmConfigurations(root), gradleConfigurations(root), mavenConfigurations(root)])
  return groups.flat()
}

export function registerRunHandlers(): void {
  handle('run:configurations', (root) => detectRunConfigurations(assertInsideProject(root)))
}
