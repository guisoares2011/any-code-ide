import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseCoordinate, parseDependencyTrees } from './dependencies'
import { mavenCommand, moduleOfClass, parsePom, readReactor } from './pom'

const TREE = `com.acme:parent:pom:1.0.0
com.acme:api:jar:1.0.0
+- org.springframework.boot:spring-boot-starter-web:jar:3.5.7:compile
|  +- org.springframework.boot:spring-boot-starter:jar:3.5.7:compile
|  |  \\- org.yaml:snakeyaml:jar:2.4:compile
|  \\- org.springframework:spring-webmvc:jar:6.2.12:compile
+- com.acme:core:jar:1.0.0:compile
\\- org.junit.jupiter:junit-jupiter:jar:5.12.2:test (optional)
`

describe('dependency:tree parsing', () => {
  it('reads coordinates with and without scope or classifier', () => {
    expect(parseCoordinate('com.acme:parent:pom:1.0.0')).toMatchObject({ artifactId: 'parent', type: 'pom', version: '1.0.0', scope: '' })
    expect(parseCoordinate('io.netty:netty-tcnative:jar:osx-aarch_64:2.0.70:runtime')).toMatchObject({ version: '2.0.70', scope: 'runtime' })
  })

  it('builds one tree per module with nested children', () => {
    const [parent, api] = parseDependencyTrees(TREE)
    expect(parent?.artifactId).toBe('parent')
    expect(parent?.children).toEqual([])
    expect(api?.children.map((c) => c.artifactId)).toEqual(['spring-boot-starter-web', 'core', 'junit-jupiter'])
    const web = api!.children[0]!
    expect(web.children.map((c) => c.artifactId)).toEqual(['spring-boot-starter', 'spring-webmvc'])
    expect(web.children[0]!.children[0]).toMatchObject({ artifactId: 'snakeyaml', version: '2.4' })
    expect(api!.children[2]).toMatchObject({ scope: 'test', optional: true })
  })
})

describe('pom reading', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'anycode-pom-'))
    await writeFile(
      join(root, 'pom.xml'),
      `<project><groupId>com.acme</groupId><artifactId>parent</artifactId><version>1.0.0</version><packaging>pom</packaging>
       <modules><module>app</module><module>core</module></modules>
       <profiles><profile><id>local</id></profile></profiles></project>`,
    )
    for (const module of ['app', 'core']) {
      await mkdir(join(root, module), { recursive: true })
      await writeFile(join(root, module, 'pom.xml'), `<project><parent><groupId>com.acme</groupId><version>1.0.0</version></parent><artifactId>acme-${module}</artifactId></project>`)
    }
    await mkdir(join(root, 'app', 'src', 'main', 'java', 'com', 'acme'), { recursive: true })
    await writeFile(join(root, 'app', 'src', 'main', 'java', 'com', 'acme', 'App.java'), 'class App {}')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('reads the reactor with inherited coordinates', () => {
    const reactor = readReactor(root)
    expect(reactor.map((m) => `${m.directory || '.'}=${m.groupId}:${m.artifactId}:${m.version}:${m.packaging}`)).toEqual([
      '.=com.acme:parent:1.0.0:pom',
      'app=com.acme:acme-app:1.0.0:jar',
      'core=com.acme:acme-core:1.0.0:jar',
    ])
    expect(reactor[0]!.profiles).toEqual(['local'])
    expect(parsePom('<project><artifactId>x</artifactId></project>').packaging).toBe('jar')
  })

  it('finds the module of a main class, or of an IntelliJ module name', () => {
    const reactor = readReactor(root)
    expect(moduleOfClass(root, reactor, 'com.acme.App')).toBe('app')
    expect(moduleOfClass(root, reactor, 'com.acme.Missing', 'acme-core')).toBe('core')
  })

  it('prefers the project wrapper', async () => {
    expect(mavenCommand(root, true)).toBe('mvn')
    await writeFile(join(root, 'mvnw'), '')
    expect(mavenCommand(root, true)).toBe('./mvnw')
  })
})
