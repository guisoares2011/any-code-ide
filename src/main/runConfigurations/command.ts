// The shell script that runs a configuration (in the project's PTY, through the login shell).
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { MavenModule } from '@shared/maven'
import type { JUnitConfiguration, RunCommand, RunConfigurationSpec } from '@shared/runConfigurations'
import { moduleOfClass } from '../maven/pom'
import { shellQuote } from '../pty'

export interface CommandContext {
  root: string
  reactor: readonly MavenModule[]
  /** Maven executable for this project (./mvnw, mvn or a downloaded distribution). */
  maven: string
  packageManager: string
  /** Gradle executable: ./gradlew when the project has one. */
  gradle: string
  /** The project builds with Gradle rather than Maven (decides how tests run). */
  usesGradle: boolean
}

const words = (text: string): string[] => text.split(/\s+/).filter(Boolean)

/** `-Dname=value` with the value quoted for the shell. */
const property = (name: string, value: string): string => shellQuote(`-D${name}=${value}`)

export function runCommand(spec: RunConfigurationSpec, context: CommandContext): RunCommand {
  const cwd = spec.workingDirectory ? join(context.root, spec.workingDirectory) : context.root
  const mvn = shellQuote(context.maven)
  let script: string
  switch (spec.type) {
    case 'maven': {
      const profiles = spec.profiles.trim() ? ` -P ${shellQuote(spec.profiles.replace(/\s+/g, ''))}` : ''
      script = `${mvn} ${words(spec.goals).map(shellQuote).join(' ')}${profiles}`
      break
    }
    case 'spring-boot': {
      // A directory, or an IntelliJ module name (imported configurations) resolved to one.
      const byDirectory = context.reactor.some((m) => m.directory === spec.module)
      const module = byDirectory ? spec.module : moduleOfClass(context.root, context.reactor, spec.mainClass, spec.module)
      const run = [
        `${mvn}${module ? ` -pl ${shellQuote(module)}` : ''} spring-boot:run`,
        property('spring-boot.run.main-class', spec.mainClass),
        spec.activeProfiles.trim() && property('spring-boot.run.profiles', spec.activeProfiles.trim()),
        spec.vmOptions.trim() && property('spring-boot.run.jvmArguments', spec.vmOptions.trim()),
        spec.programArguments.trim() && property('spring-boot.run.arguments', spec.programArguments.trim()),
      ]
        .filter(Boolean)
        .join(' ')
      // In a multi-module build the application's sibling modules come from ~/.m2, so they are
      // installed first; a single-module project compiles as part of spring-boot:run.
      script = module ? `${mvn} -q -pl ${shellQuote(module)} -am install -DskipTests && ${run}` : run
      return { script, cwd: context.root, env: spec.env }
    }
    case 'npm': {
      const extra = spec.arguments.trim() ? ` -- ${words(spec.arguments).map(shellQuote).join(' ')}` : ''
      script = `${context.packageManager} run ${shellQuote(spec.script)}${extra}`
      break
    }
    case 'shell':
      script = spec.script
      break
    case 'gradle':
      script = `${shellQuote(context.gradle)} ${words(spec.tasks).map(shellQuote).join(' ')}`
      break
    case 'junit':
      return { script: testScript(spec, context), cwd: context.root, env: spec.env }
  }
  return { script, cwd, env: spec.env }
}

/** Test filter in the build tools' syntax, or null to run every test. */
function testFilter(spec: JUnitConfiguration, tool: 'maven' | 'gradle'): string | null {
  switch (spec.scope) {
    case 'module':
      return null
    case 'package':
      if (!spec.packageName) return null
      return tool === 'maven' ? `${spec.packageName.replaceAll('.', '/')}/**/*` : `${spec.packageName}.*`
    case 'class':
      return spec.className
    case 'method':
      return tool === 'maven' ? `${spec.className}#${spec.methodName}` : `${spec.className}.${spec.methodName}`
  }
}

/**
 * Runs tests through the build, like IntelliJ's "delegate to build tool": Maven Surefire's
 * -Dtest (with -am so sibling modules compile, without failing modules that have no match) or
 * Gradle's test task with --tests.
 */
function testScript(spec: JUnitConfiguration, context: CommandContext): string {
  if (context.usesGradle) {
    const byDirectory = spec.module !== '' && existsSync(join(context.root, spec.module))
    const project = byDirectory ? `:${spec.module.replaceAll('/', ':')}:` : ''
    const filter = testFilter(spec, 'gradle')
    return [shellQuote(context.gradle), `${project}test`, filter && `--tests ${shellQuote(filter)}`].filter(Boolean).join(' ')
  }
  // A reactor directory, or an IntelliJ module name (imported configurations) resolved to one.
  const byDirectory = context.reactor.some((m) => m.directory === spec.module)
  const module = byDirectory ? spec.module : moduleOfClass(context.root, context.reactor, spec.className, spec.module, 'test')
  const filter = testFilter(spec, 'maven')
  return [
    shellQuote(context.maven),
    module && `-pl ${shellQuote(module)} -am`,
    'test',
    filter && `${property('test', filter)} -Dsurefire.failIfNoSpecifiedTests=false`,
    spec.vmOptions.trim() && property('argLine', spec.vmOptions.trim()),
  ]
    .filter(Boolean)
    .join(' ')
}
