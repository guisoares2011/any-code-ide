import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { copyInto, createDirectory, createFile, isIgnoredName, moveInto, readDirEntries, renamePath } from './fs'
import { nextScratchName } from './scratches'

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

describe('file operations of the project view', () => {
  it('creates files with their directories, refuses existing names and renames', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'anycode-fs-'))
    await createFile(join(dir, 'a', 'b', 'c.txt'), 'hi')
    expect(await readFile(join(dir, 'a', 'b', 'c.txt'), 'utf8')).toBe('hi')
    await expect(createFile(join(dir, 'a', 'b', 'c.txt'))).rejects.toThrow("'c.txt' already exists")
    await createDirectory(join(dir, 'x', 'y'))
    await expect(createDirectory(join(dir, 'x'))).rejects.toThrow('already exists')
    await renamePath(join(dir, 'a', 'b', 'c.txt'), join(dir, 'a', 'b', 'd.txt'))
    await writeFile(join(dir, 'a', 'b', 'e.txt'), '')
    await expect(renamePath(join(dir, 'a', 'b', 'd.txt'), join(dir, 'a', 'b', 'e.txt'))).rejects.toThrow('already exists')
    await rm(dir, { recursive: true, force: true })
  })

  it('copies with free Finder-style names and moves without overwriting', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'anycode-fs-'))
    await mkdir(join(dir, 'src'))
    await mkdir(join(dir, 'dest'))
    await writeFile(join(dir, 'src', 'a.ts'), 'a')
    expect(await copyInto([join(dir, 'src', 'a.ts')], join(dir, 'src'))).toEqual([join(dir, 'src', 'a copy.ts')])
    expect(await copyInto([join(dir, 'src', 'a.ts')], join(dir, 'src'))).toEqual([join(dir, 'src', 'a copy 2.ts')])
    expect(await moveInto([join(dir, 'src', 'a.ts')], join(dir, 'dest'))).toEqual([join(dir, 'dest', 'a.ts')])
    await writeFile(join(dir, 'src', 'a.ts'), 'again')
    await expect(moveInto([join(dir, 'src', 'a.ts')], join(dir, 'dest'))).rejects.toThrow('already exists')
    await expect(copyInto([join(dir, 'src')], join(dir, 'src'))).rejects.toThrow('into itself')
    await rm(dir, { recursive: true, force: true })
  })

  it('names scratch files like IntelliJ', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'anycode-scratch-'))
    expect(nextScratchName(dir, 'ts')).toBe('scratch.ts')
    await writeFile(join(dir, 'scratch.ts'), '')
    expect(nextScratchName(dir, '.ts')).toBe('scratch_1.ts')
    expect(nextScratchName(dir, 'json')).toBe('scratch.json')
    await rm(dir, { recursive: true, force: true })
  })
})
