import { describe, expect, it } from 'vitest'
import { basename, dirname, extname, isInside, normalizePath, relativePath } from './paths'

describe('paths', () => {
  it('normalizes dot segments and duplicate slashes', () => {
    expect(normalizePath('/a//b/./c/../d/')).toBe('/a/b/d')
    expect(normalizePath('/../..')).toBe('/')
  })

  it('confines targets to the root', () => {
    expect(isInside('/p/app', '/p/app')).toBe(true)
    expect(isInside('/p/app', '/p/app/src/x.ts')).toBe(true)
    expect(isInside('/p/app', '/p/app-other/x.ts')).toBe(false)
    expect(isInside('/p/app', '/p/app/../secret')).toBe(false)
    expect(isInside('/', '/anything')).toBe(true)
  })

  it('splits names', () => {
    expect(basename('/a/b/file.test.ts')).toBe('file.test.ts')
    expect(dirname('/a/b/file.ts')).toBe('/a/b')
    expect(dirname('/file.ts')).toBe('/')
    expect(extname('/a/file.test.ts')).toBe('.ts')
    expect(extname('/a/.gitignore')).toBe('')
    expect(relativePath('/a', '/a/b/c')).toBe('b/c')
    expect(relativePath('/a', '/x')).toBe('/x')
  })
})
