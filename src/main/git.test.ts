import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, realpath, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { branches, commit, commitDetails, fileAtRevision, gitStatus, headContent, log, parsePorcelain, rollback, statusKind } from './git'

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

  it('rolls back modified, deleted, added and renamed files, leaving unversioned ones', async () => {
    await writeFile(join(root, 'a.txt'), 'two\n')
    await unlink(join(root, 'gone.txt'))
    await writeFile(join(root, 'added.txt'), 'added\n')
    await writeFile(join(root, 'scratch.txt'), 'scratch\n')
    sh('add', 'added.txt')
    const paths = ['a.txt', 'gone.txt', 'added.txt', 'scratch.txt'].map((p) => join(root, p))
    expect((await rollback(root, paths, false)).ok).toBe(true)
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('one\n')
    expect(await readFile(join(root, 'gone.txt'), 'utf8')).toBe('bye\n')
    // Added files become unversioned unless deleteAdded; unversioned files are not touched.
    expect(sh('status', '--porcelain').trim().split('\n')).toEqual(['?? added.txt', '?? scratch.txt'])

    sh('add', 'added.txt')
    expect((await rollback(root, [join(root, 'added.txt')], true)).ok).toBe(true)
    expect(sh('status', '--porcelain').trim()).toBe('?? scratch.txt')

    await rename(join(root, 'a.txt'), join(root, 'b.txt'))
    sh('add', '-A', 'a.txt', 'b.txt')
    expect((await gitStatus(root)).files.find((f) => f.kind === 'renamed')?.relativePath).toBe('b.txt')
    expect((await rollback(root, [join(root, 'b.txt')], false)).ok).toBe(true)
    expect(sh('status', '--porcelain').trim()).toBe('?? scratch.txt')
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('one\n')
  })

  it('lists, filters and details the log', async () => {
    await writeFile(join(root, 'a.txt'), 'two\n')
    sh('commit', '-q', '-am', 'Change a')
    sh('checkout', '-q', '-b', 'feature')
    sh('mv', 'gone.txt', 'kept.txt')
    sh('commit', '-q', '-m', 'Rename gone')
    sh('checkout', '-q', 'main')

    const all = await log(root, {})
    expect(all.map((c) => c.subject)).toEqual(['Rename gone', 'Change a', 'initial'])
    expect(all[0]).toMatchObject({ author: 'AnyCode Test', email: 'test@example.com', parents: [all[1]!.hash], refs: ['feature'] })
    expect(all[1]!.refs).toEqual(['HEAD -> main'])
    expect((await log(root, { branch: 'main' })).map((c) => c.subject)).toEqual(['Change a', 'initial'])
    expect((await log(root, { text: 'CHANGE' })).map((c) => c.subject)).toEqual(['Change a'])
    expect((await log(root, { text: all[2]!.hash.slice(0, 7) })).map((c) => c.subject)).toEqual(['initial'])
    expect((await log(root, { author: 'nobody' })).length).toBe(0)
    expect((await log(root, { path: join(root, 'a.txt') })).map((c) => c.subject)).toEqual(['Change a', 'initial'])
    expect((await log(root, { skip: 1, limit: 1 })).map((c) => c.subject)).toEqual(['Change a'])
    expect(await branches(root)).toEqual(['feature', 'main'])

    const renamed = await commitDetails(root, all[0]!.hash)
    expect(renamed?.files).toEqual([{ path: join(root, 'kept.txt'), relativePath: 'kept.txt', kind: 'renamed', originalPath: 'gone.txt' }])
    const initial = await commitDetails(root, all[2]!.hash)
    expect(initial?.message).toBe('initial')
    expect(initial?.files.map((f) => `${f.kind}:${f.relativePath}`)).toEqual(['added:a.txt', 'added:gone.txt'])
    expect(await fileAtRevision(root, `${all[1]!.hash}^`, join(root, 'a.txt'))).toBe('one\n')
    expect(await fileAtRevision(root, `${all[2]!.hash}^`, join(root, 'a.txt'))).toBeNull()

    sh('merge', '-q', '--no-ff', '-m', 'Merge feature', 'feature')
    const merge = (await log(root, { limit: 1 }))[0]!
    expect(merge.parents).toHaveLength(2)
    expect((await commitDetails(root, merge.hash))?.files.map((f) => f.relativePath)).toEqual(['kept.txt'])
  })

  it('says when the directory is not a repository', async () => {
    const plain = await realpath(await mkdtemp(join(tmpdir(), 'anycode-plain-')))
    expect(await gitStatus(plain)).toEqual({ repository: false, branch: null, files: [] })
    await rm(plain, { recursive: true, force: true })
  })
})
