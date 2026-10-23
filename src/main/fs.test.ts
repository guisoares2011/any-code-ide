import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isIgnoredName, readDirEntries } from './fs'

describe('project tree listing', () => {
  it("hides IntelliJ's default ignored files and folders", async () => {
    expect(['.git', '.DS_Store', '__pycache__', 'a.pyc', 'notes.txt~'].every(isIgnoredName)).toBe(true)
    expect(['.gitignore', '.github', 'src', '.idea'].some(isIgnoredName)).toBe(false)
    const dir = await mkdtemp(join(tmpdir(), 'anycode-fs-'))
    await mkdir(join(dir, '.git'))
    await writeFile(join(dir, '.DS_Store'), '')
    await writeFile(join(dir, '.gitignore'), '')
    expect((await readDirEntries(dir)).map((e) => e.name)).toEqual(['.gitignore'])
    await rm(dir, { recursive: true, force: true })
  })
})
