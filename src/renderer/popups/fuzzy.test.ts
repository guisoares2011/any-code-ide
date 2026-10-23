import { describe, expect, it } from 'vitest'
import { fuzzyMatch, rank } from './fuzzy'

describe('fuzzyMatch', () => {
  it('matches characters in order', () => {
    expect(fuzzyMatch('wbs', 'src/renderer/state/workbench.ts')).not.toBeNull()
    expect(fuzzyMatch('xyz', 'workbench.ts')).toBeNull()
  })

  it('prefers camel humps and file-name prefixes', () => {
    const ranked = rank('EA', ['src/area/Everything.ts', 'src/editor/EditorArea.tsx'], (s) => s)
    expect(ranked[0]?.item).toBe('src/editor/EditorArea.tsx')
    const files = rank('dispatch', ['docs/dispatch-notes/readme.md', 'src/keymap/dispatcher.ts'], (s) => s)
    expect(files[0]?.item).toBe('src/keymap/dispatcher.ts')
  })

  it('reports matched positions for highlighting', () => {
    expect(fuzzyMatch('gf', 'Go to File')?.positions).toEqual([0, 6])
  })
})
