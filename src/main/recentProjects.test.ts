import { describe, expect, it } from 'vitest'
import { mergeRecent, parseJetBrainsRecent, parseOpenProjects, productName } from './recentProjects'

const XML = `<application>
  <component name="RecentProjectsManager">
    <option name="additionalInfo">
      <map>
        <entry key="$USER_HOME$/Documents/app">
          <value>
            <RecentProjectMetaInfo frameTitle="app – Main.java">
              <option name="activationTimestamp" value="1787013688748" />
              <option name="productionCode" value="IU" />
            </RecentProjectMetaInfo>
          </value>
        </entry>
        <entry key="$USER_HOME$/Documents/web">
          <value>
            <RecentProjectMetaInfo>
              <option name="activationTimestamp" value="1777397887705" />
            </RecentProjectMetaInfo>
          </value>
        </entry>
      </map>
    </option>
    <option name="lastOpenedProject" value="$USER_HOME$/Documents/app" />
  </component>
</application>`

describe('recent projects', () => {
  it('parses JetBrains recentProjects.xml', () => {
    expect(parseJetBrainsRecent(XML, '/Users/me', 'IntelliJ IDEA')).toEqual([
      { path: '/Users/me/Documents/app', name: 'app', source: 'IntelliJ IDEA', lastOpened: 1787013688748 },
      { path: '/Users/me/Documents/web', name: 'web', source: 'IntelliJ IDEA', lastOpened: 1777397887705 },
    ])
  })

  it('names products from config directories', () => {
    expect(productName('IntelliJIdea2026.1')).toBe('IntelliJ IDEA')
    expect(productName('WebStorm2025.3')).toBe('WebStorm')
  })

  it('keeps the newest entry per path', () => {
    const merged = mergeRecent(
      [{ path: '/a', name: 'a', source: 'WebStorm', lastOpened: 1 }],
      [
        { path: '/a', name: 'a', source: 'AnyCode', lastOpened: 5 },
        { path: '/b', name: 'b', source: 'IntelliJ IDEA', lastOpened: 3 },
      ],
    )
    expect(merged.map((p) => `${p.path}:${p.source}`)).toEqual(['/a:AnyCode', '/b:IntelliJ IDEA'])
  })
})

describe('open projects of the previous session', () => {
  it('reads one entry per window and the older single-window format', () => {
    expect(parseOpenProjects({ windows: [{ roots: ['/a', '/b'], current: '/b' }, { roots: ['/c'], current: null }, { roots: [] }] })).toEqual([
      { roots: ['/a', '/b'], current: '/b' },
      { roots: ['/c'], current: '/c' },
    ])
    expect(parseOpenProjects({ roots: ['/a', '/b'], current: '/b' })).toEqual([{ roots: ['/a', '/b'], current: '/b' }])
    expect(parseOpenProjects({ roots: ['/a'], current: '/gone' })).toEqual([{ roots: ['/a'], current: '/a' }])
    expect(parseOpenProjects(null)).toEqual([])
  })
})
