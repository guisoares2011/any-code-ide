import { describe, expect, it } from 'vitest'
import { explicitProject } from './project'

describe('startup project', () => {
  it('prefers --project, then ANYCODE_PROJECT, then a terminal working directory', () => {
    expect(explicitProject(['electron', '.', '--project=/p/a'], { ANYCODE_PROJECT: '/p/b' }, '/x', '/Users/me')).toBe('/p/a')
    expect(explicitProject([], { ANYCODE_PROJECT: '/p/b' }, '/x', '/Users/me')).toBe('/p/b')
    expect(explicitProject([], {}, '/Users/me/code/app', '/Users/me')).toBe('/Users/me/code/app')
  })

  it('opens nothing explicit when launched from the Dock or the home directory', () => {
    expect(explicitProject([], {}, '/', '/Users/me')).toBeNull()
    expect(explicitProject([], {}, '/Users/me', '/Users/me')).toBeNull()
  })
})
