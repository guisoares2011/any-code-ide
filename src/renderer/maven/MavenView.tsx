import { useCallback, useEffect, useMemo } from 'react'
import { MAVEN_LIFECYCLE, type MavenDependenciesResult, type MavenDependency, type MavenModule } from '@shared/maven'
import { emptyConfiguration, type MavenConfiguration } from '@shared/runConfigurations'
import { useActions } from '../keymap/service'
import { runConfiguration } from '../run/runState'
import { notify } from '../state/notifications'
import { createStore, useStore } from '../state/store'
import { workbench } from '../state/workbench'
import { Icon } from '../ui/Icon'
import { TreeView, type TreeNode } from '../ui/TreeView'

type DependencyState = { status: 'idle' } | { status: 'loading' } | { status: 'done'; result: MavenDependenciesResult }

/** Maven state per project root, shared by the tool window and its header button. */
const mavenState = createStore<{ root: string | null; modules: MavenModule[]; dependencies: DependencyState }>({
  root: null,
  modules: [],
  dependencies: { status: 'idle' },
})

async function loadModules(root: string): Promise<void> {
  const modules = await window.anycode.invoke('maven:modules', root)
  mavenState.set({ root, modules })
}

async function loadDependencies(): Promise<void> {
  const { root, dependencies } = mavenState.get()
  if (!root || dependencies.status === 'loading') return
  mavenState.set({ dependencies: { status: 'loading' } })
  const result = await window.anycode.invoke('maven:dependencies', root)
  if (mavenState.get().root !== root) return
  mavenState.set({ dependencies: { status: 'done', result } })
  if (!result.ok) notify('error', 'Maven: cannot resolve dependencies', result.output.slice(-2000))
}

/** "Reload All Maven Projects": re-reads the poms and, if they were loaded, the dependencies. */
export async function reloadMaven(): Promise<void> {
  const root = workbench.get().project?.root
  if (!root) return
  const hadDependencies = mavenState.get().dependencies.status !== 'idle'
  mavenState.set({ dependencies: { status: 'idle' } })
  await loadModules(root)
  if (hadDependencies) await loadDependencies()
}

/** A lifecycle phase or goal, run like IntelliJ names it: "<artifactId> [<goal>]". */
function runGoal(module: MavenModule, goals: string): void {
  const spec = {
    ...emptyConfiguration('maven', `maven-goal:${module.directory}:${goals}`, `${module.artifactId} [${goals}]`),
    origin: 'detected' as const,
    goals,
    workingDirectory: module.directory,
  } as MavenConfiguration
  void runConfiguration(spec, false)
}

const coordinate = (d: MavenDependency): string => `${d.groupId}:${d.artifactId}:${d.version}`

function dependencyNodes(dependencies: readonly MavenDependency[], prefix: string): TreeNode[] {
  return dependencies.map((d, index) => ({
    id: `${prefix}/${index}:${coordinate(d)}`,
    label: coordinate(d),
    hint: [d.scope && d.scope !== 'compile' ? d.scope : '', d.optional ? 'optional' : ''].filter(Boolean).join(' '),
    icon: 'nodes/library',
    ...(d.children.length > 0 ? { children: () => dependencyNodes(d.children, `${prefix}/${index}`) } : {}),
  }))
}

export function MavenHeaderActions() {
  return (
    <button className="icon-button" title="Reload All Maven Projects" aria-label="Reload All Maven Projects" onClick={() => void reloadMaven()}>
      <Icon name="build/mavenLoadChanges" />
    </button>
  )
}

/** IntelliJ's Maven tool window: projects with Lifecycle, Profiles, Plugins and Dependencies. */
export function MavenView({ visible }: { visible: boolean }) {
  const project = useStore(workbench, (s) => s.project)
  const { root, modules, dependencies } = useStore(mavenState, (s) => s)

  useEffect(() => {
    if (visible && project && root !== project.root) {
      mavenState.set({ root: project.root, modules: [], dependencies: { status: 'idle' } })
      void loadModules(project.root)
    }
  }, [visible, project, root])

  useActions(() => [{ id: 'Maven.Reimport', text: 'Reload All Maven Projects', perform: () => void reloadMaven() }], [])

  const dependencyChildren = useCallback(
    (module: MavenModule): TreeNode[] => {
      if (dependencies.status !== 'done') return [{ id: `${module.directory}:deps:loading`, label: 'Resolving dependencies…' }]
      if (!dependencies.result.ok) {
        return [{ id: `${module.directory}:deps:error`, label: 'Could not resolve dependencies (see Notifications)', className: 'vcs-conflicted' }]
      }
      const tree = dependencies.result.trees.find((t) => t.module.artifactId === module.artifactId && t.module.groupId === module.groupId)
      return tree ? dependencyNodes(tree.module.children, module.directory) : []
    },
    [dependencies],
  )

  const nodes = useMemo(() => {
    const byDirectory = new Map(modules.map((m) => [m.directory, m]))
    const childDirectories = (module: MavenModule): string[] =>
      module.modules.map((m) => (module.directory ? `${module.directory}/${m}` : m)).filter((d) => byDirectory.has(d))
    const moduleNode = (module: MavenModule): TreeNode => ({
      id: `module:${module.directory}`,
      label: module.artifactId,
      icon: module.directory === '' ? 'build/mavenProject' : 'build/mavenModule',
      hint: module.version,
      children: () => [
        {
          id: `${module.directory}:lifecycle`,
          label: 'Lifecycle',
          icon: 'nodes/folder',
          children: MAVEN_LIFECYCLE.map((phase) => ({
            id: `${module.directory}:lifecycle:${phase}`,
            label: phase,
            icon: 'build/mavenGoal',
            title: `Run ${module.artifactId} [${phase}]`,
            onActivate: () => runGoal(module, phase),
          })),
        },
        ...(module.profiles.length > 0
          ? [
              {
                id: `${module.directory}:profiles`,
                label: 'Profiles',
                icon: 'build/mavenProfiles',
                children: module.profiles.map((p) => ({ id: `${module.directory}:profile:${p}`, label: p })),
              },
            ]
          : []),
        ...(module.plugins.length > 0
          ? [
              {
                id: `${module.directory}:plugins`,
                label: 'Plugins',
                icon: 'build/mavenPlugin',
                children: module.plugins.map((p) => ({ id: `${module.directory}:plugin:${p}`, label: p, icon: 'build/mavenPlugin' })),
              },
            ]
          : []),
        ...(module.packaging !== 'pom'
          ? [
              {
                id: `${module.directory}:dependencies`,
                label: 'Dependencies',
                icon: 'nodes/library',
                onExpand: () => {
                  if (mavenState.get().dependencies.status === 'idle') void loadDependencies()
                },
                children: () => dependencyChildren(module),
              },
            ]
          : []),
        ...childDirectories(module).map((d) => moduleNode(byDirectory.get(d)!)),
      ],
    })
    const top = byDirectory.get('')
    return top ? [moduleNode(top)] : []
  }, [modules, dependencyChildren])

  if (!project) return <div className="empty-state">No project open</div>
  if (root === project.root && modules.length === 0) {
    return <div className="empty-state">No Maven projects.<br />Open a project with a pom.xml.</div>
  }
  return <TreeView nodes={nodes} label="Maven" initiallyExpanded={['module:']} />
}
