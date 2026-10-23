import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/700.css'
import './styles/global.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { installBridgeClient } from './bridge/bridgeClient'
import { setupMonaco } from './editor/monacoSetup'
import { installEditorOpener } from './editor/navigation'
import { installLanguageServers } from './lsp/client'
import { installMarkdownSupport } from './markdown/markdownSupport'
import { installTestSupport } from './run/testSupport'
import { installEslint } from './lint/eslint'
import { installSettings } from './settings/applySettings'
import { installGitStatus } from './state/git'
import { installKeymapDispatcher } from './keymap/service'
import { showTabProject, switchProject, workbench } from './state/workbench'
import { applyIslandsDark } from './theme/applyTheme'
import { Workbench } from './workbench/Workbench'

async function main(): Promise<void> {
  applyIslandsDark()
  await installSettings()
  installKeymapDispatcher()
  installBridgeClient()
  setupMonaco()
  installEditorOpener()
  installLanguageServers()
  installMarkdownSupport()
  installTestSupport()
  installEslint()
  const { projects, current } = await window.anycode.invoke('project:initial')
  const project = projects.find((p) => p.root === current) ?? null
  workbench.set({ project, projects })
  // Remember the shown project for the next start and keep the window title in sync.
  let shown: string | null = null
  const syncProject = (): void => {
    const root = workbench.get().project?.root ?? null
    if (root === shown) return
    shown = root
    document.title = workbench.get().project?.name ?? 'AnyCode'
    if (root) window.anycode.send('project:activated', root)
  }
  workbench.subscribe(syncProject)
  syncProject()
  // The current project follows the active editor tab, so terminal, git and run match the file in view.
  let lastTab: string | null = null
  workbench.subscribe(() => {
    const s = workbench.get()
    if (s.activeTab === lastTab) return
    lastTab = s.activeTab
    if (s.activeTab) showTabProject(s.activeTab)
  })
  // Another window asked to open a project this one has: show it.
  window.anycode.on('project:reveal', (root) => switchProject(root))
  if (!project) workbench.set({ popup: 'Projects' })
  installGitStatus()

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Workbench />
    </StrictMode>,
  )

  // Ready for headless screenshots once fonts are in and React has painted.
  await document.fonts.ready
  requestAnimationFrame(() => window.anycode.send('app:rendererReady'))
}

void main()
