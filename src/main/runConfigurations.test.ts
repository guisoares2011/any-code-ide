import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { detectRunConfigurations } from './runConfigurations'

describe('detectRunConfigurations', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'anycode-run-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('lists package.json scripts with the package manager from the lockfile', async () => {
    await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { dev: 'vite', test: 'vitest' } }))
    await writeFile(join(root, 'pnpm-lock.yaml'), '')
    const configurations = await detectRunConfigurations(root)
    expect(configurations).toEqual([
      { id: 'npm:dev', name: 'dev', kind: 'npm', command: ['pnpm', 'run', 'dev'] },
      { id: 'npm:test', name: 'test', kind: 'npm', command: ['pnpm', 'run', 'test'] },
    ])
  })

  it('prefers the Gradle and Maven wrappers', async () => {
    await writeFile(join(root, 'gradlew'), '')
    await writeFile(join(root, 'pom.xml'), '<project><plugin>spring-boot-maven-plugin</plugin></project>')
    const ids = (await detectRunConfigurations(root)).map((c) => `${c.id}=${c.command.join(' ')}`)
    expect(ids).toContain('gradle:test=./gradlew test')
    expect(ids).toContain('maven:spring-boot:run=mvn spring-boot:run')
  })

  it('returns nothing for an empty directory', async () => {
    expect(await detectRunConfigurations(root)).toEqual([])
  })
})
