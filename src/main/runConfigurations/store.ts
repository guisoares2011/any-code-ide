// All run configurations of a project, from every origin, and saving/deleting the editable ones.
import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { RunConfigurationSpec } from '@shared/runConfigurations'
import { readReactor } from '../maven/pom'
import { detectRunConfigurations } from './detect'
import { parseRunFile, parseWorkspaceRunManager, runFileName, toRunFile } from './intellij'

/** When several origins define the same name, the more specific one wins. */
const PRECEDENCE: Record<RunConfigurationSpec['origin'], number> = { 'project-file': 0, anycode: 1, intellij: 2, detected: 3 }

interface PrivateFile {
  configurations: RunConfigurationSpec[]
}

export class RunConfigurationStore {
  constructor(private readonly dataDir: string) {}

  private privateFile(root: string): string {
    return join(this.dataDir, 'run-configurations', `${createHash('sha1').update(root).digest('hex')}.json`)
  }

  private async readPrivate(root: string): Promise<RunConfigurationSpec[]> {
    try {
      return (JSON.parse(await readFile(this.privateFile(root), 'utf8')) as PrivateFile).configurations
    } catch {
      return []
    }
  }

  private async writePrivate(root: string, configurations: RunConfigurationSpec[]): Promise<void> {
    const file = this.privateFile(root)
    await mkdir(join(this.dataDir, 'run-configurations'), { recursive: true })
    await writeFile(file, JSON.stringify({ configurations } satisfies PrivateFile, null, 2))
  }

  private async readProjectFiles(root: string): Promise<RunConfigurationSpec[]> {
    const dir = join(root, '.run')
    if (!existsSync(dir)) return []
    const result: RunConfigurationSpec[] = []
    for (const name of await readdir(dir)) {
      if (!name.endsWith('.run.xml')) continue
      try {
        const spec = parseRunFile(await readFile(join(dir, name), 'utf8'), root, name)
        if (spec) result.push(spec)
      } catch {
        // malformed file: skip it
      }
    }
    return result
  }

  private async readIntellij(root: string): Promise<RunConfigurationSpec[]> {
    try {
      return parseWorkspaceRunManager(await readFile(join(root, '.idea', 'workspace.xml'), 'utf8'), root)
    } catch {
      return []
    }
  }

  async list(root: string): Promise<RunConfigurationSpec[]> {
    const groups = await Promise.all([
      this.readProjectFiles(root),
      this.readPrivate(root),
      this.readIntellij(root),
      detectRunConfigurations(root, readReactor(root)),
    ])
    const byName = new Map<string, RunConfigurationSpec>()
    for (const spec of groups.flat()) {
      const current = byName.get(spec.name)
      if (!current || PRECEDENCE[spec.origin] < PRECEDENCE[current.origin]) byName.set(spec.name, spec)
    }
    return [...byName.values()].sort((a, b) => PRECEDENCE[a.origin] - PRECEDENCE[b.origin] || a.name.localeCompare(b.name))
  }

  /**
   * Saves a configuration privately, or as .run/<name>.run.xml when `asProjectFile` (shared with the
   * team and with IntelliJ). Saving an imported or detected configuration creates an editable copy
   * that shadows it by name. Returns the saved configuration with its new id and origin.
   */
  async save(root: string, spec: RunConfigurationSpec, asProjectFile: boolean): Promise<RunConfigurationSpec> {
    await this.remove(root, spec.id)
    if (asProjectFile) {
      const fileName = runFileName(spec.name)
      await mkdir(join(root, '.run'), { recursive: true })
      await writeFile(join(root, '.run', fileName), `${toRunFile(spec).trimEnd()}\n`)
      return { ...spec, id: `file:${fileName}`, origin: 'project-file' }
    }
    // Anything not already stored by AnyCode (new, detected, imported, project file) gets a new id.
    const saved: RunConfigurationSpec = { ...spec, id: spec.id.startsWith('anycode:') ? spec.id : `anycode:${randomUUID()}`, origin: 'anycode' }
    const others = (await this.readPrivate(root)).filter((c) => c.id !== saved.id && c.name !== saved.name)
    await this.writePrivate(root, [...others, saved])
    return saved
  }

  /** Deletes an AnyCode or project-file configuration; imported and detected ones stay. */
  async remove(root: string, id: string): Promise<void> {
    if (id.startsWith('file:')) {
      await rm(join(root, '.run', id.slice('file:'.length)), { force: true })
      return
    }
    if (id.startsWith('anycode:')) {
      const remaining = (await this.readPrivate(root)).filter((c) => c.id !== id)
      await this.writePrivate(root, remaining)
    }
  }
}
