import { describe, expect, it } from 'vitest'
import type { RunConfigurationSpec } from '@shared/runConfigurations'
import { parseRunFile, parseWorkspaceRunManager, runFileName, toRunFile } from './intellij'

const WORKSPACE = `<?xml version="1.0" encoding="UTF-8"?>
<project version="4">
  <component name="RunManager" selected="Spring Boot.Api">
    <configuration name="Api" type="SpringBootApplicationConfigurationType" factoryName="Spring Boot">
      <module name="acme-api" />
      <option name="ACTIVE_PROFILES" value="local" />
      <option name="SPRING_BOOT_MAIN_CLASS" value="com.acme.ApiApplication" />
      <option name="VM_PARAMETERS" value="-Xmx1g" />
      <envs><env name="DB_URL" value="jdbc:x" /></envs>
      <method v="2"><option name="Make" enabled="true" /></method>
    </configuration>
    <configuration name="parent [package]" type="MavenRunConfiguration" factoryName="Maven">
      <MavenSettings>
        <option name="myGeneralSettings" />
        <option name="myRunnerParameters">
          <MavenRunnerParameters>
            <option name="goals"><list><option value="clean" /><option value="package" /></list></option>
            <option name="profiles"><set><option value="dev" /></set></option>
            <option name="workingDirPath" value="$PROJECT_DIR$/core" />
          </MavenRunnerParameters>
        </option>
      </MavenSettings>
    </configuration>
    <configuration name="E2E" type="ShConfigurationType">
      <option name="SCRIPT_TEXT" value="./e2e.sh --fast" />
      <option name="EXECUTE_SCRIPT_FILE" value="false" />
      <option name="SCRIPT_WORKING_DIRECTORY" value="$PROJECT_DIR$" />
    </configuration>
    <configuration name="ApiTest" type="JUnit" factoryName="JUnit" temporary="true" />
    <configuration name="GreetingTest.greets" type="JUnit" factoryName="JUnit">
      <module name="acme-api" />
      <option name="PACKAGE_NAME" value="com.acme" />
      <option name="MAIN_CLASS_NAME" value="com.acme.GreetingTest" />
      <option name="METHOD_NAME" value="greets" />
      <option name="TEST_OBJECT" value="method" />
    </configuration>
    <configuration name="Tagged" type="JUnit" factoryName="JUnit"><option name="TEST_OBJECT" value="tags" /></configuration>
    <configuration name="AppTest" type="GradleRunConfiguration" factoryName="Gradle">
      <ExternalSystemSettings>
        <option name="scriptParameters" value="--tests &quot;com.acme.AppTest&quot;" />
        <option name="taskNames"><list><option value=":app:test" /></list></option>
      </ExternalSystemSettings>
    </configuration>
    <configuration name="compose" type="docker-deploy" factoryName="docker-compose.yml" />
  </component>
</project>`

describe('IntelliJ run configurations', () => {
  it('imports the types AnyCode runs from workspace.xml, skipping temporary and unsupported ones', () => {
    const specs = parseWorkspaceRunManager(WORKSPACE, '/p')
    expect(specs.map((s) => `${s.type}:${s.name}`)).toEqual(['spring-boot:Api', 'maven:parent [package]', 'shell:E2E', 'junit:GreetingTest.greets', 'gradle:AppTest'])
    expect(specs[3]).toMatchObject({ scope: 'method', module: 'acme-api', className: 'com.acme.GreetingTest', methodName: 'greets' })
    expect(specs[4]).toMatchObject({ tasks: ':app:test --tests "com.acme.AppTest"' })
    expect(specs[0]).toMatchObject({
      origin: 'intellij',
      mainClass: 'com.acme.ApiApplication',
      module: 'acme-api',
      activeProfiles: 'local',
      vmOptions: '-Xmx1g',
      env: { DB_URL: 'jdbc:x' },
    })
    expect(specs[1]).toMatchObject({ goals: 'clean package', profiles: 'dev', workingDirectory: 'core' })
    expect(specs[2]).toMatchObject({ script: './e2e.sh --fast', workingDirectory: '' })
  })

  it('round-trips every type through a .run.xml file', () => {
    const base = { origin: 'project-file' as const, env: { A: '1' }, workingDirectory: 'app' }
    const specs: RunConfigurationSpec[] = [
      { ...base, id: 'x', name: 'Api', type: 'spring-boot', mainClass: 'com.acme.Api', module: 'acme-api', activeProfiles: 'local', vmOptions: '-Xmx1g', programArguments: '--x' },
      { ...base, id: 'x', name: 'Build', type: 'maven', goals: 'clean install -DskipTests', profiles: 'dev,ci' },
      { ...base, id: 'x', name: 'Dev', type: 'npm', script: 'dev', arguments: '--port 3000' },
      { ...base, id: 'x', name: 'Script', type: 'shell', script: 'echo "<hi> & bye"' },
      { ...base, id: 'x', name: 'Tasks', type: 'gradle', tasks: 'clean build' },
      { ...base, id: 'x', name: 'One test', type: 'junit', scope: 'method', module: 'api', packageName: 'com.acme', className: 'com.acme.ApiTest', methodName: 'greets', vmOptions: '-ea' },
      { ...base, id: 'x', name: 'All', type: 'junit', scope: 'module', module: 'api', packageName: '', className: '', methodName: '', vmOptions: '' },
      { ...base, id: 'x', name: 'Package', type: 'junit', scope: 'package', module: '', packageName: 'com.acme', className: '', methodName: '', vmOptions: '' },
    ]
    for (const spec of specs) {
      const xml = toRunFile(spec)
      expect(xml).toContain('ProjectRunConfigurationManager')
      const back = parseRunFile(xml, '/p', runFileName(spec.name))!
      const { id: _id, workingDirectory, env, ...rest } = spec
      expect(back).toMatchObject({ ...rest, id: `file:${runFileName(spec.name)}` })
      if (spec.type === 'maven' || spec.type === 'shell') expect(back.workingDirectory).toBe(workingDirectory)
      if (spec.type !== 'maven' && spec.type !== 'gradle') expect(back.env).toEqual(env)
    }
  })

  it('names files like IntelliJ', () => {
    expect(runFileName('Api [local]')).toBe('Api_local_.run.xml')
  })
})
