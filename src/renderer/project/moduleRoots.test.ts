import { describe, expect, it } from 'vitest'
import type { MavenModule } from '@shared/maven'
import { mavenDecorations } from './moduleRoots'

const module = (directory: string, artifactId: string, packaging = 'jar'): MavenModule => ({
  directory,
  groupId: 'com.acme',
  artifactId,
  version: '1.0',
  packaging,
  modules: [],
  profiles: [],
  plugins: [],
})

describe('Maven module decorations', () => {
  it('marks module directories and their standard source roots', () => {
    const decorations = mavenDecorations('/p', [module('', 'parent', 'pom'), module('core', 'core'), module('apps/web', 'acme-web')])
    expect(decorations.get('/p')).toBeUndefined()
    expect(decorations.get('/p/core')).toEqual({ icon: 'nodes/module', bold: true })
    expect(decorations.get('/p/apps/web')).toEqual({ icon: 'nodes/module', bold: true, moduleName: 'acme-web' })
    expect(decorations.get('/p/core/src/main/java')?.icon).toBe('nodes/sourceRoot')
    expect(decorations.get('/p/core/src/test/java')?.icon).toBe('nodes/testRoot')
    expect(decorations.get('/p/core/src/main/resources')?.icon).toBe('nodes/resourcesRoot')
    expect(decorations.get('/p/core/target')?.icon).toBe('nodes/excludeRoot')
    // An aggregator pom has no sources of its own.
    expect(decorations.get('/p/src/main/java')).toBeUndefined()
  })

  it('gives a single-module project its source roots', () => {
    expect(mavenDecorations('/p', [module('', 'app')]).get('/p/src/main/java')?.icon).toBe('nodes/sourceRoot')
  })
})
