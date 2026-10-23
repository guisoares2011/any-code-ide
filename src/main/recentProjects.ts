// Recent projects: AnyCode's own list plus the ones JetBrains IDEs remember
// (~/Library/Application Support/JetBrains/<Product><Version>/options/recentProjects.xml).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { XMLParser } from 'fast-xml-parser'
import type { RecentProject } from '@shared/ipc'
import { basename } from '@shared/paths'

const MAX_RECENT = 50

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', isArray: (name) => name === 'entry' || name === 'option' })

type Node = Record<string, unknown>
const list = (value: unknown): Node[] => (Array.isArray(value) ? (value as Node[]) : value ? [value as Node] : [])

/** Product name from a JetBrains config directory, e.g. "IntelliJIdea2026.1" -> "IntelliJ IDEA". */
export function productName(configDir: string): string {
  const name = configDir.replace(/\d.*$/, '')
  const known: Record<string, string> = {
    IntelliJIdea: 'IntelliJ IDEA',
    IdeaIC: 'IntelliJ IDEA CE',
    WebStorm: 'WebStorm',
    PyCharm: 'PyCharm',
    PyCharmCE: 'PyCharm CE',
    DataGrip: 'DataGrip',
    GoLand: 'GoLand',
    PhpStorm: 'PhpStorm',
    RubyMine: 'RubyMine',
    CLion: 'CLion',
    Rider: 'Rider',
    RustRover: 'RustRover',
    AndroidStudio: 'Android Studio',
  }
  return known[name] ?? name
}

/** Entries of one recentProjects.xml. Paths use $USER_HOME$, expanded with `home`. */
export function parseJetBrainsRecent(xml: string, home: string, source: string): RecentProject[] {
  const doc = parser.parse(xml) as { application?: { component?: Node | Node[] } }
  const result: RecentProject[] = []
  for (const component of list(doc.application?.component)) {
    for (const option of list(component.option)) {
      if (option.name !== 'additionalInfo') continue
      for (const entry of list((option.map as Node | undefined)?.entry)) {
        const key = typeof entry.key === 'string' ? entry.key : null
        if (!key) continue
        const meta = (entry.value as Node | undefined)?.RecentProjectMetaInfo as Node | undefined
        const timestamp = list(meta?.option).find((o) => o.name === 'activationTimestamp')?.value
        const path = key.replace('$USER_HOME$', home)
        result.push({ path, name: basename(path), source, lastOpened: Number(timestamp ?? 0) })
      }
    }
  }
  return result
}

/** Recent projects of every installed JetBrains IDE that still exist on disk. */
export function readJetBrainsRecent(home = homedir()): RecentProject[] {
  const base = join(home, 'Library', 'Application Support', 'JetBrains')
  if (!existsSync(base)) return []
  const result: RecentProject[] = []
  for (const dir of readdirSync(base)) {
    const file = join(base, dir, 'options', 'recentProjects.xml')
    if (!existsSync(file)) continue
    try {
      result.push(...parseJetBrainsRecent(readFileSync(file, 'utf8'), home, productName(dir)))
    } catch {
      // unreadable or malformed file: skip that IDE
    }
  }
  return result.filter((p) => {
    try {
      return statSync(p.path).isDirectory()
    } catch {
      return false
    }
  })
}

/** Newest entry per path, newest first. */
export function mergeRecent(...lists: RecentProject[][]): RecentProject[] {
  const byPath = new Map<string, RecentProject>()
  for (const project of lists.flat()) {
    const existing = byPath.get(project.path)
    if (!existing || project.lastOpened > existing.lastOpened) byPath.set(project.path, project)
  }
  return [...byPath.values()].sort((a, b) => b.lastOpened - a.lastOpened).slice(0, MAX_RECENT)
}

export class RecentProjectsStore {
  constructor(private readonly file: string) {}

  async read(): Promise<RecentProject[]> {
    try {
      return JSON.parse(await readFile(this.file, 'utf8')) as RecentProject[]
    } catch {
      return []
    }
  }

  async touch(path: string): Promise<void> {
    const list = mergeRecent(await this.read(), [{ path, name: basename(path), source: 'AnyCode', lastOpened: Date.now() }])
    await mkdir(dirname(this.file), { recursive: true })
    await writeFile(this.file, JSON.stringify(list, null, 2))
  }
}

/** Projects open when the app last ran, reopened on the next start. */
export class OpenProjectsStore {
  constructor(private readonly file: string) {}

  async read(): Promise<{ roots: string[]; current: string | null }> {
    try {
      const saved = JSON.parse(await readFile(this.file, 'utf8')) as { roots?: unknown; current?: unknown }
      const roots = Array.isArray(saved.roots) ? saved.roots.filter((r): r is string => typeof r === 'string') : []
      return { roots, current: typeof saved.current === 'string' ? saved.current : null }
    } catch {
      return { roots: [], current: null }
    }
  }

  async write(roots: string[], current: string | null): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true })
    await writeFile(this.file, JSON.stringify({ roots, current: current ?? roots[0] ?? null }, null, 2))
  }
}
