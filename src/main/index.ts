import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { app, BrowserWindow, dialog, shell } from 'electron'
import { createBridge, failPendingToolCalls } from './bridge'
import { registerFsHandlers } from './fs'
import { registerEslintHandlers, stopAllEslint, stopEslint } from './eslint/index'
import { registerGitHandlers } from './git'
import { currentSettings, registerSettingsHandlers, userShell } from './settings'
import { emit, handle, onSend } from './ipc'
import { registerLspHandlers, stopAllLanguageServers } from './lsp/manager'
import { homedir } from 'node:os'
import { closeProject, explicitProject, openProject, openRoots } from './project'
import { mergeRecent, OpenProjectsStore, readJetBrainsRecent, RecentProjectsStore } from './recentProjects'
import { killAllPtys, registerPtyHandlers } from './pty'
import { registerRunHandlers } from './runConfigurations/index'
import { adoptShellEnv } from './shellEnv'
import { watchProject } from './watcher'

/**
 * ANYCODE_HEADLESS=1 keeps every window hidden (no Dock icon either) so the app can run while the
 * user works on something else. ANYCODE_SCREENSHOT=<png> captures the window once the renderer is
 * ready; ANYCODE_EXIT_AFTER_SCREENSHOT=1 quits afterwards.
 */
const headless = process.env.ANYCODE_HEADLESS === '1'
// Tests point user data (recent projects...) at a temporary directory.
if (process.env.ANYCODE_USER_DATA) app.setPath('userData', process.env.ANYCODE_USER_DATA)
const screenshotPath = process.env.ANYCODE_SCREENSHOT
const exitAfterScreenshot = process.env.ANYCODE_EXIT_AFTER_SCREENSHOT === '1'
// Settle time for fonts, Monaco and layout after the renderer reports ready
// (ANYCODE_SCREENSHOT_DELAY_MS waits longer, e.g. for the agent to connect).
const SCREENSHOT_SETTLE_MS = Number(process.env.ANYCODE_SCREENSHOT_DELAY_MS ?? 800)
// A screenshot run never outlives this, even if the renderer fails to report ready.
const SCREENSHOT_DEADLINE_MS = 60_000

// Islands Dark token `container-main-window-bg`; shown before the renderer paints.
const WINDOW_BACKGROUND = '#26282C'

const explicit = explicitProject(process.argv, process.env, process.cwd(), homedir())
let mainWindow: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 500,
    show: false,
    backgroundColor: WINDOW_BACKGROUND,
    title: 'AnyCode',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 13 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  })

  if (!headless) window.once('ready-to-show', () => window.show())

  // Links open in the user's browser, never in a new Electron window.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (!headless && /^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devServer = process.env.ELECTRON_RENDERER_URL
  if (devServer) void window.loadURL(devServer)
  else void window.loadFile(join(__dirname, '../renderer/index.html'))
  return window
}

async function captureScreenshot(window: BrowserWindow, path: string): Promise<void> {
  const image = await window.webContents.capturePage()
  const target = resolve(path)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, image.toPNG())
  console.log(`[anycode] screenshot saved to ${target}`)
}

/** Agent tab command: ANYCODE_AGENT_COMMAND, else the setting ("" = plain shell); headless runs default to a shell. */
function agentCommand(): string[] | null {
  const configured = process.env.ANYCODE_AGENT_COMMAND ?? (headless ? '' : currentSettings().terminal.agentCommand)
  return configured.trim() ? configured.trim().split(/\s+/) : null
}

handle('app:info', () => ({ platform: process.platform, headless, version: app.getVersion(), agentCommand: agentCommand() }))
const session = new OpenProjectsStore(join(app.getPath('userData'), 'open-projects.json'))

// Startup projects: the explicit one alone, or the previous session's (current one last activated).
handle('project:initial', async () => {
  const saved = explicit ? { roots: [explicit], current: explicit } : await session.read()
  const projects = saved.roots.flatMap((root) => openProject(root) ?? [])
  for (const p of projects) watch(p.root)
  await bridge.updateWorkspaceFolders()
  await session.write(projects.map((p) => p.root), saved.current)
  const current = projects.find((p) => p.root === saved.current)?.root ?? projects[0]?.root ?? null
  if (current) await recent.touch(current)
  return { projects, current }
})
onSend('project:activated', (root) => {
  void session.write(openRoots(), root)
  void recent.touch(root)
})
registerSettingsHandlers(join(app.getPath('userData'), 'settings.json'))
registerFsHandlers()
registerGitHandlers()
registerRunHandlers(app.getPath('userData'))
registerEslintHandlers()

// Claude Code connects here (/ide); terminals get CLAUDE_CODE_SSE_PORT so `claude` finds it.
const bridge = createBridge({
  version: app.getVersion(),
  workspaceFolders: openRoots,
  renderer: () => mainWindow?.webContents ?? null,
})

// One recursive watcher per open project.
const watchers = new Map<string, () => void>()
function watch(root: string): void {
  if (watchers.has(root)) return
  watchers.set(
    root,
    watchProject(root, (paths) => {
      if (mainWindow) emit(mainWindow.webContents, 'fs:changed', paths)
    }),
  )
}

const recent = new RecentProjectsStore(join(app.getPath('userData'), 'recent-projects.json'))

handle('project:open', async (path) => {
  const opened = openProject(path)
  if (!opened) return null
  watch(opened.root)
  await recent.touch(opened.root)
  await bridge.updateWorkspaceFolders()
  await session.write(openRoots(), opened.root)
  return opened
})
handle('project:close', async (root) => {
  closeProject(root)
  stopEslint(root)
  watchers.get(root)?.()
  watchers.delete(root)
  await bridge.updateWorkspaceFolders()
  await session.write(openRoots(), null)
})
handle('project:recent', async () => mergeRecent(await recent.read(), readJetBrainsRecent()))
handle('project:pickFolder', async () => {
  if (headless || !mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] })
  return result.canceled ? null : (result.filePaths[0] ?? null)
})
registerPtyHandlers(
  () => mainWindow?.webContents ?? null,
  () => bridge.terminalEnv(),
)
registerLspHandlers(() => mainWindow?.webContents ?? null)

onSend('app:rendererReady', () => {
  const window = mainWindow
  if (!window || !screenshotPath) return
  setTimeout(() => {
    void captureScreenshot(window, screenshotPath).finally(() => {
      if (exitAfterScreenshot) app.quit()
    })
  }, SCREENSHOT_SETTLE_MS)
})

if (headless && process.platform === 'darwin') app.dock?.hide()
if (exitAfterScreenshot) {
  setTimeout(() => {
    console.error('[anycode] screenshot deadline exceeded')
    app.exit(1)
  }, SCREENSHOT_DEADLINE_MS).unref()
}

void app.whenReady().then(async () => {
  // Before any terminal, language server or build starts: they all need the user's PATH.
  await adoptShellEnv(userShell())
  try {
    await bridge.start()
  } catch (error) {
    console.error('[anycode] Claude Code bridge failed to start:', error)
  }
  mainWindow = createWindow()
  mainWindow.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) failPendingToolCalls('The AnyCode window reloaded')
  })
  mainWindow.on('closed', () => {
    mainWindow = null
    failPendingToolCalls('The AnyCode window closed')
  })
  app.on('activate', () => {
    if (!mainWindow) mainWindow = createWindow()
  })
})

app.on('before-quit', () => {
  killAllPtys()
  stopAllLanguageServers()
  stopAllEslint()
})
app.on('will-quit', () => {
  for (const stop of watchers.values()) stop()
  bridge.disposeSync()
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' || headless) app.quit()
})
