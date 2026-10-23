export interface MavenModule {
  /** Directory relative to the project root; "" for the root project. */
  directory: string
  groupId: string
  artifactId: string
  version: string
  packaging: string
  /** Module directories declared in <modules>, relative to this module. */
  modules: string[]
  /** Profile ids declared in this pom. */
  profiles: string[]
  /** Build plugin artifactIds declared in this pom. */
  plugins: string[]
}

export interface MavenDependency {
  groupId: string
  artifactId: string
  type: string
  version: string
  /** compile, test, runtime, provided, system, import; empty for the module itself. */
  scope: string
  optional: boolean
  children: MavenDependency[]
}

/** `mvn dependency:tree` result for one reactor module. */
export interface MavenDependencyTree {
  module: MavenDependency
}

export type MavenDependenciesResult =
  | { ok: true; trees: MavenDependencyTree[] }
  | { ok: false; output: string }

/** Default lifecycle phases, as the IntelliJ Maven tool window lists them. */
export const MAVEN_LIFECYCLE = ['clean', 'validate', 'compile', 'test', 'package', 'verify', 'install', 'site', 'deploy'] as const
