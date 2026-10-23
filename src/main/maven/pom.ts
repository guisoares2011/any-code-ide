// Reading Maven projects without running Maven: the reactor (modules) and coordinates from pom.xml.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative } from 'node:path'
import { XMLParser } from 'fast-xml-parser'
import type { MavenModule } from '@shared/maven'

const parser = new XMLParser({
  ignoreAttributes: true,
  isArray: (name) => ['module', 'dependency', 'plugin', 'profile'].includes(name),
  parseTagValue: false,
})

type Node = Record<string, unknown>
const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')
const nodes = (value: unknown): Node[] => (Array.isArray(value) ? (value as Node[]) : [])

interface ParsedPom {
  groupId: string
  artifactId: string
  version: string
  packaging: string
  modules: string[]
  profiles: string[]
  plugins: string[]
}

export function parsePom(xml: string): ParsedPom {
  const project = (parser.parse(xml) as { project?: Node }).project ?? {}
  const parent = (project.parent as Node | undefined) ?? {}
  const build = (project.build as Node | undefined) ?? {}
  return {
    groupId: text(project.groupId) || text(parent.groupId),
    artifactId: text(project.artifactId),
    version: text(project.version) || text(parent.version),
    packaging: text(project.packaging) || 'jar',
    modules: nodes((project.modules as Node | undefined)?.module as unknown).map((m) => text(m as unknown)).filter(Boolean),
    profiles: nodes((project.profiles as Node | undefined)?.profile).map((p) => text(p.id)).filter(Boolean),
    plugins: nodes((build.plugins as Node | undefined)?.plugin).map((p) => text(p.artifactId)).filter(Boolean),
  }
}

/** The reactor rooted at `root`: the root project and its modules, recursively. */
export function readReactor(root: string): MavenModule[] {
  const result: MavenModule[] = []
  const visit = (dir: string): void => {
    const file = join(dir, 'pom.xml')
    if (!existsSync(file)) return
    let pom: ParsedPom
    try {
      pom = parsePom(readFileSync(file, 'utf8'))
    } catch {
      return
    }
    result.push({
      directory: relative(root, dir),
      groupId: pom.groupId,
      artifactId: pom.artifactId,
      version: pom.version,
      packaging: pom.packaging,
      modules: pom.modules,
      profiles: pom.profiles,
      plugins: pom.plugins,
    })
    for (const module of pom.modules) visit(join(dir, module))
  }
  visit(root)
  return result
}

/**
 * Module directory owning a main class: the module whose src/main/java (or kotlin) contains the
 * class file. Falls back to matching an IntelliJ module name against artifactIds.
 */
export function moduleOfClass(root: string, reactor: readonly MavenModule[], mainClass: string, intellijModule?: string): string {
  const path = mainClass.replaceAll('.', '/')
  for (const module of reactor) {
    for (const [lang, ext] of [['java', 'java'], ['kotlin', 'kt']] as const) {
      if (existsSync(join(root, module.directory, 'src', 'main', lang, `${path}.${ext}`))) return module.directory
    }
  }
  if (intellijModule) {
    const byArtifact = reactor.find((m) => m.artifactId === intellijModule)
    if (byArtifact) return byArtifact.directory
  }
  return ''
}

/**
 * Command to run Maven in a project: its wrapper when present, then `mvn` (from the login shell's
 * PATH), else a distribution a wrapper already downloaded to ~/.m2/wrapper.
 */
export function mavenCommand(root: string, pathHasMvn: boolean, home = homedir()): string {
  if (existsSync(join(root, 'mvnw'))) return './mvnw'
  if (pathHasMvn) return 'mvn'
  const dists = join(home, '.m2', 'wrapper', 'dists')
  if (existsSync(dists)) {
    const candidates: string[] = []
    for (const dist of readdirSync(dists)) {
      for (const hash of safeList(join(dists, dist))) {
        for (const unpacked of safeList(join(dists, dist, hash))) {
          const bin = join(dists, dist, hash, unpacked, 'bin', 'mvn')
          if (existsSync(bin)) candidates.push(bin)
        }
      }
    }
    const newest = candidates.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1)
    if (newest) return newest
  }
  return 'mvn'
}

function safeList(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}
