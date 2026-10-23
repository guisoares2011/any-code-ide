import { describe, expect, it } from 'vitest'
import { isIgnoredChange } from './watcher'

describe('watcher filter', () => {
  it('ignores build output and dependencies but keeps git signals', () => {
    expect(isIgnoredChange('src/a.ts')).toBe(false)
    expect(isIgnoredChange('node_modules/x/index.js')).toBe(true)
    expect(isIgnoredChange('out/main/index.js')).toBe(true)
    expect(isIgnoredChange('.git/objects/ab/cdef')).toBe(true)
    expect(isIgnoredChange('.git/index')).toBe(false)
    expect(isIgnoredChange('.git/HEAD')).toBe(false)
    expect(isIgnoredChange('.git/refs/heads/main')).toBe(false)
  })
})
