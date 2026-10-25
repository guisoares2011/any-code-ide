import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { MavenModule } from '@shared/maven'
import { emptyConfiguration, type JUnitConfiguration, type RunConfigurationSpec } from '@shared/runConfigurations'
import { readReactor } from '../maven/pom'
import { runCommand, type CommandContext } from './command'
import { detectRunConfigurations } from './detect'
import { RunConfigurationStore } from './store'

const module = (directory: string, artifactId: string): MavenModule => ({
  directory,
  groupId: 'com.acme',
  artifactId,
  version: '1',
  packaging: 'jar',
  modules: [],
  profiles: [],
  plugins: [],
})

const context: CommandContext = {
  root: '/p',
  reactor: [module('', 'parent'), module('api', 'acme-api')],
  maven: './mvnw',
  packageManager: 'pnpm',
  gradle: './gradlew',
  usesGradle: false,
}

describe('run commands', () => {
  it('runs Spring Boot apps of a module after installing what they depend on', () => {
    const spec = {
      ...emptyConfiguration('spring-boot', 'x', 'Api'),
      mainClass: 'com.acme.Api',
      module: 'api',
      activeProfiles: 'local',
      vmOptions: '-Xmx1g -Dx=y',
    } as RunConfigurationSpec
    expect(runCommand(spec, context)).toEqual({
      script:
        "./mvnw -q -pl api -am install -DskipTests && ./mvnw -pl api spring-boot:run -Dspring-boot.run.main-class=com.acme.Api -Dspring-boot.run.profiles=local '-Dspring-boot.run.jvmArguments=-Xmx1g -Dx=y'",
      cwd: '/p',
      env: {},
    })
  })

  it('maps an IntelliJ module name to its directory', () => {
    const spec = { ...emptyConfiguration('spring-boot', 'x', 'Api'), mainClass: 'com.acme.Api', module: 'acme-api' } as RunConfigurationSpec
    expect(runCommand(spec, context).script).toContain('-pl api spring-boot:run')
  })

  it('builds Maven, npm, shell and Gradle commands', () => {
    const maven = { ...emptyConfiguration('maven', 'x', 'b'), goals: 'clean install -DskipTests', profiles: 'dev, ci', workingDirectory: 'api' } as RunConfigurationSpec
    expect(runCommand(maven, context)).toMatchObject({ script: './mvnw clean install -DskipTests -P dev,ci', cwd: '/p/api' })
    const npm = { ...emptyConfiguration('npm', 'x', 'dev'), script: 'dev', arguments: '--port 3000' } as RunConfigurationSpec
    expect(runCommand(npm, context).script).toBe('pnpm run dev -- --port 3000')
    const shell = { ...emptyConfiguration('shell', 'x', 's'), script: 'echo hi && ls', env: { A: '1' } } as RunConfigurationSpec
    expect(runCommand(shell, context)).toMatchObject({ script: 'echo hi && ls', env: { A: '1' } })
    const gradle = { ...emptyConfiguration('gradle', 'x', 'g'), tasks: 'clean build' } as RunConfigurationSpec
    expect(runCommand(gradle, context).script).toBe('./gradlew clean build')
  })

  it('runs JUnit tests through Surefire or Gradle, by module, package, class or method', () => {
    const junit = (patch: Partial<JUnitConfiguration>): RunConfigurationSpec => ({ ...(emptyConfiguration('junit', 'x', 't') as JUnitConfiguration), ...patch })
    const method = junit({ scope: 'method', module: 'api', className: 'com.acme.ApiTest', methodName: 'greets', vmOptions: '-Xmx1g -ea' })
    expect(runCommand(method, context)).toEqual({
      script: "./mvnw -pl api -am test '-Dtest=com.acme.ApiTest#greets' -Dsurefire.failIfNoSpecifiedTests=false '-DargLine=-Xmx1g -ea'",
      cwd: '/p',
      env: {},
    })
    expect(runCommand(junit({ scope: 'class', className: 'com.acme.ParentTest' }), context).script).toBe(
      './mvnw test -Dtest=com.acme.ParentTest -Dsurefire.failIfNoSpecifiedTests=false',
    )
    expect(runCommand(junit({ scope: 'package', module: 'acme-api', packageName: 'com.acme.web' }), context).script).toBe(
      "./mvnw -pl api -am test '-Dtest=com/acme/web/**/*' -Dsurefire.failIfNoSpecifiedTests=false",
    )
    expect(runCommand(junit({ scope: 'module', module: 'api' }), context).script).toBe('./mvnw -pl api -am test')

    const gradle = { ...context, usesGradle: true }
    expect(runCommand(method, gradle).script).toBe("./gradlew test --tests com.acme.ApiTest.greets")
    expect(runCommand(junit({ scope: 'package', packageName: 'com.acme' }), gradle).script).toBe("./gradlew test --tests 'com.acme.*'")
  })

  it('starts JVMs that wait for the debugger when debugging', () => {
    const agent = '-agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=127.0.0.1:41234'
    const app = { ...emptyConfiguration('spring-boot', 'x', 'Api'), mainClass: 'com.acme.Api', vmOptions: '-Xmx1g' } as RunConfigurationSpec
    expect(runCommand(app, context, { port: 41234 })).toEqual({
      script: `./mvnw spring-boot:run -Dspring-boot.run.main-class=com.acme.Api '-Dspring-boot.run.jvmArguments=${agent} -Xmx1g'`,
      cwd: '/p',
      env: {},
      debugPort: 41234,
    })
    const test = { ...(emptyConfiguration('junit', 'x', 't') as JUnitConfiguration), className: 'com.acme.ApiTest' }
    expect(runCommand(test, context, { port: 41234 })).toMatchObject({
      script: `./mvnw test -Dtest=com.acme.ApiTest -Dsurefire.failIfNoSpecifiedTests=false -Dmaven.surefire.debug=${agent}`,
      debugPort: 41234,
    })
    // Gradle's --debug-jvm has a fixed port.
    expect(runCommand(test, { ...context, usesGradle: true }, { port: 41234 })).toMatchObject({
      script: './gradlew test --tests com.acme.ApiTest --debug-jvm',
      debugPort: 5005,
    })
  })
})

describe('run configuration store', () => {
  let root: string
  let data: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'anycode-runcfg-'))
    data = await mkdtemp(join(tmpdir(), 'anycode-data-'))
    await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { dev: 'vite', test: 'vitest' } }))
    await writeFile(join(root, 'pom.xml'), '<project><groupId>com.acme</groupId><artifactId>app</artifactId><version>1</version></project>')
    await mkdir(join(root, 'src', 'main', 'java', 'com', 'acme'), { recursive: true })
    await writeFile(join(root, 'src', 'main', 'java', 'com', 'acme', 'App.java'), '@SpringBootApplication\npublic class App {}')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(data, { recursive: true, force: true })
  })

  it('detects npm scripts and @SpringBootApplication classes', async () => {
    const detected = await detectRunConfigurations(root, readReactor(root))
    expect(detected.map((c) => `${c.type}:${c.name}`)).toEqual(['spring-boot:App', 'npm:dev', 'npm:test'])
    expect(detected[0]).toMatchObject({ mainClass: 'com.acme.App', module: '' })
  })

  it('saves privately or as an IntelliJ project file, shadowing detected ones by name', async () => {
    const store = new RunConfigurationStore(data)
    const detected = (await store.list(root)).find((c) => c.name === 'dev')!
    const edited = await store.save(root, { ...detected, arguments: '--open' } as RunConfigurationSpec, false)
    expect(edited.origin).toBe('anycode')
    let all = await store.list(root)
    expect(all.filter((c) => c.name === 'dev')).toEqual([edited])

    const shared = await store.save(root, edited, true)
    expect(shared).toMatchObject({ origin: 'project-file', id: 'file:dev.run.xml' })
    expect(await readFile(join(root, '.run', 'dev.run.xml'), 'utf8')).toContain('type="js.build_tools.npm"')
    all = await store.list(root)
    expect(all.filter((c) => c.name === 'dev')).toEqual([expect.objectContaining({ origin: 'project-file', arguments: '--open' })])

    await store.remove(root, shared.id)
    expect((await store.list(root)).find((c) => c.name === 'dev')?.origin).toBe('detected')
  })
})
