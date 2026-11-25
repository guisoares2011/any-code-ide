import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SearchOptions } from '@shared/textSearch'
import { MAX_MATCHES, searchFiles } from './search'

const options = (query: string, extra: Partial<SearchOptions> = {}): SearchOptions => ({
  query,
  caseSensitive: false,
  wholeWords: false,
  regex: false,
  fileMask: '',
  ...extra,
})

describe('searchFiles', () => {
  let root: string
  beforeAll(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'anycode-search-')))
    await mkdir(join(root, 'src/sub'), { recursive: true })
    await mkdir(join(root, 'node_modules/dep'), { recursive: true })
    await writeFile(join(root, 'src/a.ts'), 'const needle = 1\n// needle again\n')
    await writeFile(join(root, 'src/sub/b.md'), 'a Needle here\n')
    await writeFile(join(root, 'src/c.bin'), Buffer.from([110, 101, 101, 100, 108, 101, 0, 1]))
    await writeFile(join(root, 'node_modules/dep/index.js'), 'needle\n')
  })
  afterAll(() => rm(root, { recursive: true, force: true }))

  it('finds matches in text files, skipping binaries and ignored directories', async () => {
    const result = await searchFiles({ id: 1, root, options: options('needle') })
    expect(result.total).toBe(3)
    expect(result.files.map((f) => f.path).sort()).toEqual([join(root, 'src/a.ts'), join(root, 'src/sub/b.md')])
    expect(result.files.find((f) => f.path.endsWith('a.ts'))!.matches.map((m) => m.line)).toEqual([1, 2])
  })

  it('applies the directory scope, the file mask and the options', async () => {
    expect((await searchFiles({ id: 2, root, directory: join(root, 'src/sub'), options: options('needle') })).total).toBe(1)
    expect((await searchFiles({ id: 3, root, options: options('needle', { fileMask: '*.md' }) })).total).toBe(1)
    expect((await searchFiles({ id: 4, root, options: options('Needle', { caseSensitive: true }) })).total).toBe(1)
    expect((await searchFiles({ id: 5, root, options: options('(', { regex: true }) })).error).toBeTruthy()
  })

  it('stops at the match limit and when cancelled', async () => {
    await writeFile(join(root, 'src/many.txt'), 'x\n'.repeat(MAX_MATCHES + 10))
    const result = await searchFiles({ id: 6, root, options: options('x', { fileMask: 'many.txt' }) })
    expect(result).toMatchObject({ total: MAX_MATCHES, truncated: true })
    expect((await searchFiles({ id: 7, root, options: options('needle') }, () => true)).total).toBe(0)
  })
})
