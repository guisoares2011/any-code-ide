// IntelliJ run configuration XML: <configuration> elements of .idea/workspace.xml (RunManager) and
// .run/*.run.xml (ProjectRunConfigurationManager). Supports the types AnyCode can run.
import { XMLBuilder, XMLParser } from 'fast-xml-parser'
import type { RunConfigurationOrigin, RunConfigurationSpec } from '@shared/runConfigurations'

type Node = Record<string, unknown>

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  parseAttributeValue: false,
  parseTagValue: false,
  isArray: (name) => ['configuration', 'option', 'env', 'script', 'component'].includes(name),
})

const list = (value: unknown): Node[] => (Array.isArray(value) ? (value as Node[]) : value ? [value as Node] : [])
const attr = (node: Node | undefined, name: string): string => {
  const value = node?.[`@${name}`]
  return typeof value === 'string' ? value : ''
}

/** IntelliJ path macros, relative to the project root. */
function expandMacros(value: string, root: string): string {
  return value.replaceAll('$PROJECT_DIR$', root).replaceAll('$USER_HOME$', process.env.HOME ?? '')
}

function relativeDir(value: string, root: string): string {
  const expanded = expandMacros(value, root)
  if (!expanded || expanded === root) return ''
  return expanded.startsWith(`${root}/`) ? expanded.slice(root.length + 1) : expanded
}

function options(node: Node): Map<string, Node> {
  return new Map(list(node.option).map((o) => [attr(o, 'name'), o]))
}

function envs(node: Node): Record<string, string> {
  const result: Record<string, string> = {}
  for (const env of list((node.envs as Node | undefined)?.env)) result[attr(env, 'name')] = attr(env, 'value')
  return result
}

/** Converts one <configuration>; null for types AnyCode does not run (Docker, Application...). */
export function fromIntellij(node: Node, root: string, origin: RunConfigurationOrigin, id: string): RunConfigurationSpec | null {
  const name = attr(node, 'name')
  const type = attr(node, 'type')
  const opts = options(node)
  const value = (key: string): string => attr(opts.get(key), 'value')
  const base = { id, name, origin, env: envs(node), workingDirectory: '' }
  switch (type) {
    case 'SpringBootApplicationConfigurationType':
      return {
        ...base,
        type: 'spring-boot',
        mainClass: value('SPRING_BOOT_MAIN_CLASS'),
        // IntelliJ stores the module name; AnyCode resolves the directory when running.
        module: attr(node.module as Node | undefined, 'name'),
        activeProfiles: value('ACTIVE_PROFILES'),
        vmOptions: value('VM_PARAMETERS'),
        programArguments: value('PROGRAM_PARAMETERS'),
      }
    case 'MavenRunConfiguration': {
      const parameters = ((node.MavenSettings as Node | undefined)?.option as Node[] | undefined)
        ?.find((o) => attr(o, 'name') === 'myRunnerParameters')
        ?.MavenRunnerParameters as Node | undefined
      const params = parameters ? options(parameters) : new Map<string, Node>()
      const goals = list((params.get('goals')?.list as Node | undefined)?.option).map((o) => attr(o, 'value'))
      const profiles = list((params.get('profiles')?.set as Node | undefined)?.option).map((o) => attr(o, 'value'))
      return {
        ...base,
        type: 'maven',
        goals: goals.join(' '),
        profiles: profiles.join(','),
        workingDirectory: relativeDir(attr(params.get('workingDirPath'), 'value'), root),
      }
    }
    case 'ShConfigurationType': {
      const fromFile = value('EXECUTE_SCRIPT_FILE') === 'true'
      const scriptPath = expandMacros(value('SCRIPT_PATH'), root)
      return {
        ...base,
        type: 'shell',
        script: fromFile ? `${scriptPath} ${value('SCRIPT_OPTIONS')}`.trim() : value('SCRIPT_TEXT'),
        workingDirectory: relativeDir(value('SCRIPT_WORKING_DIRECTORY'), root),
      }
    }
    case 'js.build_tools.npm': {
      const script = list((node.scripts as Node | undefined)?.script).map((s) => attr(s, 'value'))[0] ?? ''
      return { ...base, type: 'npm', script, arguments: attr(node.arguments as Node | undefined, 'value') }
    }
    case 'GradleRunConfiguration': {
      const settings = options((node.ExternalSystemSettings as Node | undefined) ?? {})
      const tasks = list((settings.get('taskNames')?.list as Node | undefined)?.option).map((o) => attr(o, 'value'))
      // Test runs delegated to Gradle keep their filter here ("--tests com.acme.AppTest").
      const parameters = attr(settings.get('scriptParameters'), 'value')
      return { ...base, type: 'gradle', tasks: [...tasks, parameters].filter(Boolean).join(' ') }
    }
    case 'JUnit': {
      const testObject = value('TEST_OBJECT') || 'class'
      // "All in package" with no package is every test of the module.
      const scope =
        testObject === 'package' && !value('PACKAGE_NAME') ? 'module' : testObject === 'method' || testObject === 'package' || testObject === 'class' ? testObject : null
      // Patterns, tags, directories and categories have no build tool equivalent here.
      if (!scope) return null
      return {
        ...base,
        type: 'junit',
        scope,
        module: attr(node.module as Node | undefined, 'name'),
        packageName: value('PACKAGE_NAME'),
        className: value('MAIN_CLASS_NAME'),
        methodName: value('METHOD_NAME'),
        vmOptions: value('VM_PARAMETERS'),
      }
    }
    default:
      return null
  }
}

/** Run configurations IntelliJ keeps privately for a project (non-temporary ones). */
export function parseWorkspaceRunManager(xml: string, root: string): RunConfigurationSpec[] {
  const doc = parser.parse(xml) as { project?: { component?: Node[] } }
  const manager = list(doc.project?.component).find((c) => attr(c, 'name') === 'RunManager')
  if (!manager) return []
  return list(manager.configuration)
    .filter((c) => attr(c, 'temporary') !== 'true' && attr(c, 'name'))
    .flatMap((c) => fromIntellij(c, root, 'intellij', `intellij:${attr(c, 'type')}:${attr(c, 'name')}`) ?? [])
}

/** One .run/<name>.run.xml file. */
export function parseRunFile(xml: string, root: string, fileName: string): RunConfigurationSpec | null {
  const doc = parser.parse(xml) as { component?: Node[] }
  const configuration = list(list(doc.component)[0]?.configuration)[0]
  return configuration ? fromIntellij(configuration, root, 'project-file', `file:${fileName}`) : null
}

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  format: true,
  indentBy: '  ',
  suppressEmptyNode: true,
})

const option = (name: string, value: string): Node => ({ '@name': name, '@value': value })

function intellijBody(spec: RunConfigurationSpec): { type: string; factoryName?: string; body: Node } {
  const envBlock = Object.keys(spec.env).length
    ? { envs: { env: Object.entries(spec.env).map(([name, value]) => ({ '@name': name, '@value': value })) } }
    : {}
  const dir = (relative: string): string => (relative ? `$PROJECT_DIR$/${relative}` : '$PROJECT_DIR$')
  switch (spec.type) {
    case 'spring-boot':
      return {
        type: 'SpringBootApplicationConfigurationType',
        factoryName: 'Spring Boot',
        body: {
          ...(spec.module ? { module: { '@name': spec.module } } : {}),
          option: [
            option('ACTIVE_PROFILES', spec.activeProfiles),
            option('PROGRAM_PARAMETERS', spec.programArguments),
            option('SPRING_BOOT_MAIN_CLASS', spec.mainClass),
            option('VM_PARAMETERS', spec.vmOptions),
          ].filter((o) => o['@value'] !== ''),
          ...envBlock,
        },
      }
    case 'maven':
      return {
        type: 'MavenRunConfiguration',
        factoryName: 'Maven',
        body: {
          MavenSettings: {
            option: [
              {
                '@name': 'myRunnerParameters',
                MavenRunnerParameters: {
                  option: [
                    { '@name': 'goals', list: { option: spec.goals.split(/\s+/).filter(Boolean).map((g) => ({ '@value': g })) } },
                    { '@name': 'profiles', set: { option: spec.profiles.split(',').filter(Boolean).map((p) => ({ '@value': p.trim() })) } },
                    option('workingDirPath', dir(spec.workingDirectory)),
                  ],
                },
              },
            ],
          },
        },
      }
    case 'shell':
      return {
        type: 'ShConfigurationType',
        body: {
          option: [
            option('SCRIPT_TEXT', spec.script),
            option('EXECUTE_SCRIPT_FILE', 'false'),
            option('SCRIPT_WORKING_DIRECTORY', dir(spec.workingDirectory)),
          ],
          ...envBlock,
        },
      }
    case 'npm':
      return {
        type: 'js.build_tools.npm',
        body: {
          'package-json': { '@value': `${dir(spec.workingDirectory)}/package.json` },
          command: { '@value': 'run' },
          scripts: { script: [{ '@value': spec.script }] },
          ...(spec.arguments ? { arguments: { '@value': spec.arguments } } : {}),
          'node-interpreter': { '@value': 'project' },
          ...envBlock,
        },
      }
    case 'gradle':
      return {
        type: 'GradleRunConfiguration',
        factoryName: 'Gradle',
        body: {
          ExternalSystemSettings: {
            option: [
              option('externalProjectPath', dir(spec.workingDirectory)),
              { '@name': 'taskNames', list: { option: spec.tasks.split(/\s+/).filter(Boolean).map((t) => ({ '@value': t })) } },
            ],
          },
        },
      }
    case 'junit':
      return {
        type: 'JUnit',
        factoryName: 'JUnit',
        body: {
          ...(spec.module ? { module: { '@name': spec.module } } : {}),
          option: [
            option('PACKAGE_NAME', spec.scope === 'package' ? spec.packageName : spec.className.slice(0, Math.max(spec.className.lastIndexOf('.'), 0))),
            option('MAIN_CLASS_NAME', spec.scope === 'package' || spec.scope === 'module' ? '' : spec.className),
            option('METHOD_NAME', spec.scope === 'method' ? spec.methodName : ''),
            // IntelliJ has no "module" kind: all tests of a module are the package kind with no package.
            option('TEST_OBJECT', spec.scope === 'module' ? 'package' : spec.scope),
            option('VM_PARAMETERS', spec.vmOptions),
          ].filter((o) => o['@value'] !== '' || o['@name'] === 'TEST_OBJECT'),
          ...envBlock,
        },
      }
  }
}

/** .run/<name>.run.xml content in IntelliJ's format, so IntelliJ shows the same configuration. */
export function toRunFile(spec: RunConfigurationSpec): string {
  const { type, factoryName, body } = intellijBody(spec)
  const configuration: Node = {
    '@default': 'false',
    '@name': spec.name,
    '@type': type,
    ...(factoryName ? { '@factoryName': factoryName } : {}),
    ...body,
    method: { '@v': '2' },
  }
  return builder.build({ component: { '@name': 'ProjectRunConfigurationManager', configuration } }) as string
}

/** File name IntelliJ would use: the name with unsafe characters replaced. */
export function runFileName(name: string): string {
  return `${name.replace(/[^\w.-]+/g, '_')}.run.xml`
}
