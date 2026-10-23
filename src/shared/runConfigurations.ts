// Run configurations, modeled on IntelliJ's types so they can be imported from and saved to the
// IntelliJ formats (.idea/workspace.xml RunManager, .run/*.run.xml).

export type RunConfigurationType = 'spring-boot' | 'maven' | 'npm' | 'shell' | 'gradle'

/**
 * Where a configuration comes from:
 * - detected: derived from package.json scripts / build files, not stored;
 * - anycode: private to this machine, stored in AnyCode's data directory;
 * - project-file: shared in the project as .run/<name>.run.xml (IntelliJ reads it too);
 * - intellij: imported read-only from IntelliJ's .idea/workspace.xml.
 */
export type RunConfigurationOrigin = 'detected' | 'anycode' | 'project-file' | 'intellij'

interface BaseConfiguration {
  /** Stable within the project, e.g. "anycode:3f2a…", "file:App.run.xml", "npm:dev". */
  id: string
  name: string
  origin: RunConfigurationOrigin
  /** Extra environment variables. */
  env: Record<string, string>
  /** Working directory relative to the project root; "" is the root. */
  workingDirectory: string
}

export interface SpringBootConfiguration extends BaseConfiguration {
  type: 'spring-boot'
  mainClass: string
  /** Maven module directory relative to the root ("" for single-module projects); derived when empty. */
  module: string
  activeProfiles: string
  vmOptions: string
  programArguments: string
}

export interface MavenConfiguration extends BaseConfiguration {
  type: 'maven'
  /** Goals and options as typed, e.g. "clean install -DskipTests". */
  goals: string
  profiles: string
}

export interface NpmConfiguration extends BaseConfiguration {
  type: 'npm'
  script: string
  arguments: string
}

export interface ShellConfiguration extends BaseConfiguration {
  type: 'shell'
  /** Script text, run by the login shell. */
  script: string
}

export interface GradleConfiguration extends BaseConfiguration {
  type: 'gradle'
  tasks: string
}

export type RunConfigurationSpec =
  | SpringBootConfiguration
  | MavenConfiguration
  | NpmConfiguration
  | ShellConfiguration
  | GradleConfiguration

export const RUN_CONFIGURATION_TYPES: readonly { type: RunConfigurationType; title: string }[] = [
  { type: 'spring-boot', title: 'Spring Boot' },
  { type: 'maven', title: 'Maven' },
  { type: 'npm', title: 'npm' },
  { type: 'shell', title: 'Shell Script' },
  { type: 'gradle', title: 'Gradle' },
]

/** A new configuration of a type with empty fields. */
export function emptyConfiguration(type: RunConfigurationType, id: string, name: string): RunConfigurationSpec {
  const base = { id, name, origin: 'anycode' as const, env: {}, workingDirectory: '' }
  switch (type) {
    case 'spring-boot':
      return { ...base, type, mainClass: '', module: '', activeProfiles: '', vmOptions: '', programArguments: '' }
    case 'maven':
      return { ...base, type, goals: '', profiles: '' }
    case 'npm':
      return { ...base, type, script: '', arguments: '' }
    case 'shell':
      return { ...base, type, script: '' }
    case 'gradle':
      return { ...base, type, tasks: '' }
  }
}

/** What the renderer needs to start a configuration in a terminal. */
export interface RunCommand {
  /** Script for the login shell (`$SHELL -l -c <script>`). */
  script: string
  /** Absolute working directory. */
  cwd: string
  env: Record<string, string>
}

/** IntelliJ's one-line environment variables field: `KEY=value;KEY2=value`. */
export function formatEnv(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join(';')
}

export function parseEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const pair of text.split(';')) {
    const index = pair.indexOf('=')
    const key = (index < 0 ? pair : pair.slice(0, index)).trim()
    if (key) env[key] = index < 0 ? '' : pair.slice(index + 1).trim()
  }
  return env
}
