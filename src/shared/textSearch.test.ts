import { describe, expect, it } from 'vitest'
import { buildPattern, fileMaskFilter, findMatches, replaceAll, replacementFor, type SearchOptions } from './textSearch'

const options = (query: string, extra: Partial<SearchOptions> = {}): SearchOptions => ({
  query,
  caseSensitive: false,
  wholeWords: false,
  regex: false,
  fileMask: '',
  ...extra,
})

function pattern(query: string, extra: Partial<SearchOptions> = {}): RegExp {
  const built = buildPattern(options(query, extra))
  if (!(built instanceof RegExp)) throw new Error(built.error)
  return built
}

describe('buildPattern', () => {
  it('escapes plain text and ignores case by default', () => {
    expect(findMatches('a.b AXB a.B', pattern('a.b')).map((m) => m.column)).toEqual([1, 9])
  })

  it('honours Match case, Words and Regex', () => {
    expect(findMatches('Foo foo', pattern('foo', { caseSensitive: true })).map((m) => m.column)).toEqual([5])
    expect(findMatches('foo food _foo foo', pattern('foo', { wholeWords: true })).map((m) => m.column)).toEqual([1, 15])
    expect(findMatches('a1 b22 c', pattern('[a-z]\\d+', { regex: true })).map((m) => m.column)).toEqual([1, 4])
  })

  it('accepts escapes Java allows and reports invalid patterns', () => {
    expect(buildPattern(options('a\\-b', { regex: true }))).toBeInstanceOf(RegExp)
    expect(buildPattern(options('(', { regex: true }))).toHaveProperty('error')
    expect(buildPattern(options(''))).toHaveProperty('error')
  })
})

describe('findMatches', () => {
  it('reports lines, columns and the trimmed line as preview', () => {
    const [match] = findMatches('first\n    const value = 1\n', pattern('value'))
    expect(match).toEqual({ line: 2, column: 11, endLine: 2, endColumn: 16, preview: 'const value = 1', previewStart: 6, previewEnd: 11 })
  })

  it('cuts long lines around the match', () => {
    const line = `${'x'.repeat(500)}needle${'y'.repeat(500)}`
    const [match] = findMatches(line, pattern('needle'))
    expect(match!.preview.length).toBeLessThan(200)
    expect(match!.preview.slice(match!.previewStart, match!.previewEnd)).toBe('needle')
  })

  it('handles CRLF, multi-line regexes, empty matches and the limit', () => {
    expect(findMatches('a\r\nb a\r\n', pattern('a'))[1]).toMatchObject({ line: 2, column: 3, preview: 'b a' })
    expect(findMatches('one\ntwo', pattern('e\\nt', { regex: true }))[0]).toMatchObject({ line: 1, column: 3, endLine: 2, endColumn: 2, previewEnd: 3 })
    expect(findMatches('abc', pattern('x*', { regex: true }))).toEqual([])
    expect(findMatches('a a a a', pattern('a'), 2)).toHaveLength(2)
  })
})

describe('replace', () => {
  it('expands groups in regex mode and is literal otherwise', () => {
    expect(replaceAll('foo(1) foo(2)', pattern('foo\\((\\d)\\)', { regex: true }), 'bar[$1]', true)).toBe('bar[1] bar[2]')
    expect(replaceAll('a.b a.b', pattern('a.b'), '$1$&', false)).toBe('$1$& $1$&')
    expect(replacementFor('foo(7)', pattern('foo\\((\\d)\\)', { regex: true }), '<$1>', true)).toBe('<7>')
    expect(replacementFor('x', pattern('x'), '$&', false)).toBe('$&')
  })
})

describe('fileMaskFilter', () => {
  it('matches names, paths and exclusions like IntelliJ file masks', () => {
    const ts = fileMaskFilter('*.ts, *.tsx, !*.test.ts')
    expect(ts('src/a.ts')).toBe(true)
    expect(ts('src/b.tsx')).toBe(true)
    expect(ts('src/a.test.ts')).toBe(false)
    expect(ts('README.md')).toBe(false)
    expect(fileMaskFilter('!*.md')('src/a.ts')).toBe(true)
    expect(fileMaskFilter('src/**/*.java')('src/main/java/A.java')).toBe(true)
    expect(fileMaskFilter('src/**/*.java')('test/A.java')).toBe(false)
    expect(fileMaskFilter('')('anything')).toBe(true)
  })
})
