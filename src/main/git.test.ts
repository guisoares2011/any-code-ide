import { execFileSync } from 'node:child_process'
import { mkdtemp, realpath, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commit, gitStatus, headContent, parsePorcelain, statusKind } from './git'

describe('porcelain parsing', () => {
  it('classifies status columns', () => {
    expect(statusKind(' M')).toBe('modified')
    expect(statusKind('M ')).toBe('modified')
    expect(statusKind('A ')).toBe('added')
    expect(statusKind(' D')).toBe('deleted')
    expect(statusKind('R ')).toBe('renamed')
    expect(statusKind('??')).toBe('untracked')
    expect(statusKind('UU')).toBe('conflicted')
  })

  it('keeps the original path of renames', () => {
    const files = parsePorcelain('R  new.ts\0old.ts\0 M a.ts\0?? b c.ts\0', '/r')
    expect(files).toEqual([
      { path: '/r/a.ts', relativePath: 'a.ts', kind: 'modified', staged: false },
      { path: '/r/b c.ts', relativePath: 'b c.ts', kind: 'untracked', staged: false },
      { path: '/r/new.ts', relativePath: 'new.ts', kind: 'renamed', staged: true, originalPath: 'old.ts' },
    ])
  })
})

describe('git operations on a real repository', () => {
  let root: string
  const sh = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'anycode-git-')))
    sh('init', '-q', '-b', 'main')
    sh('config', 'user.email', 'test@example.com')
    sh('config', 'user.name', 'AnyCode Test')
    sh('config', 'commit.gpgsign', 'false')
    await writeFile(join(root, 'a.txt'), 'one\n')
    await writeFile(join(root, 'gone.txt'), 'bye\n')
    sh('add', '.')
    sh('commit', '-q', '-m', 'initial')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('reports branch and changes', async () => {
    await writeFile(join(root, 'a.txt'), 'two\n')
    await writeFile(join(root, 'new.txt'), 'new\n')
    await unlink(join(root, 'gone.txt'))
    const status = await gitStatus(root)
    expect(status).toMatchObject({ repository: true, branch: 'main' })
    expect(status.files.map((f) => `${f.kind}:${f.relativePath}`)).toEqual(['modified:a.txt', 'deleted:gone.txt', 'untracked:new.txt'])
    expect(await headContent(root, join(root, 'a.txt'))).toBe('one\n')
    expect(await headContent(root, join(root, 'new.txt'))).toBeNull()
  })

  it('commits only the selected files, adding new ones', async () => {
    await writeFile(join(root, 'a.txt'), 'two\n')
    await writeFile(join(root, 'new.txt'), 'new\n')
    await unlink(join(root, 'gone.txt'))
    const result = await commit(root, 'Change a and add new', [join(root, 'a.txt'), join(root, 'new.txt')])
    expect(result.ok).toBe(true)
    expect(sh('log', '-1', '--format=%s').trim()).toBe('Change a and add new')
    expect(sh('show', '--name-status', '--format=', 'HEAD').trim().split('\n').sort()).toEqual(['A\tnew.txt', 'M\ta.txt'])
    // The deletion was not selected and stays uncommitted.
    expect((await gitStatus(root)).files.map((f) => `${f.kind}:${f.relativePath}`)).toEqual(['deleted:gone.txt'])
  })

  it('refuses an empty message', async () => {
    expect(await commit(root, '  ', [join(root, 'a.txt')])).toEqual({ ok: false, output: 'The commit message is empty.' })
  })

  it('says when the directory is not a repository', async () => {
    const plain = await realpath(await mkdtemp(join(tmpdir(), 'anycode-plain-')))
    expect(await gitStatus(plain)).toEqual({ repository: false, branch: null, files: [] })
    await rm(plain, { recursive: true, force: true })
  })
})
