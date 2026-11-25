import { mkdirSync, statSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { app, BrowserWindow, dialog, Menu, MenuItem, shell, type WebContents } from 'electron'
import type { ProjectInfo } from '@shared/ipc'
import { basename } from '@shared/paths'
import { createBridge, failPendingToolCalls, registerBridgeHandlers } from './bridge'
import type { IdeBridgeServer } from './bridge/server'
import { registerFsHandlers } from './fs'
import { registerScratchHandlers } from './scratches'
import { registerSearchHandlers } from './search'
import { registerEslintHandlers, stopAllEslint, stopEslint } from './eslint/index'
import { registerGitHandlers } from './git'
import { currentSettings, registerSettingsHandlers, userShell } from './settings'
import { emit, handle, handleFrom, onSend, onSendFrom } from './ipc'
import { registerLspHandlers, stopAllLanguageServers } from './lsp/manager'
import { registerDebugHandlers, stopDebugging } from './debug/index'
import { homedir } from 'node:os'
import { closeProject, explicitProject, openProject } from './project'
import { OpenProjectsStore, readJetBrainsRecent, RecentProjectsStore, visibleRecent, type SavedWindow } from './recentProjects'
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
// A project window, and the smaller Welcome screen of a window without projects (IntelliJ's sizes).
const PROJECT_SIZE = { width: 1440, height: 900 }
const WELCOME_SIZE = { width: 800, height: 650 }

const explicit = explicitProject(process.argv, process.env, process.cwd(), homedir())

/**
 * A project window, like IntelliJ's: its projects (more than one when attached), the one shown, and
 * its own Claude Code bridge, so the `claude` of each window sees and drives only that window.
 */
interface ProjectWindow {
  window: BrowserWindow
  contents: WebContents
  roots: string[]
  current: string | null
  bridge: IdeBridgeServer
  /** Projects moved in from another window: their agent resumes its conversation (claude --continue). */
  resume: string[]
}

/** Open windows by webContents id, in creation order. */
const windows = new Map<number, ProjectWindow>()
const windowOf = (sender: WebContents): ProjectWindow | undefined => windows.get(sender.id)
const ownerOf = (root: string): ProjectWindow | undefined => [...windows.values()].find((w) => w.roots.includes(root))
const projectInfo = (root: string): ProjectInfo => ({ root, name: basename(root) })
let quitting = false

function createBrowserWindow(welcome: boolean): BrowserWindow {
  const window = new BrowserWindow({
    ...(welcome ? WELCOME_SIZE : PROJECT_SIZE),
    minWidth: 600,
    minHeight: 400,
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
  return window
}

function loadRenderer(window: BrowserWindow): void {
  const devServer = process.env.ELECTRON_RENDERER_URL
  if (devServer) void window.loadURL(devServer)
  else void window.loadFile(join(__dirname, '../renderer/index.html'))
}

/** Saves the windows and their projects; reopened at the next start. */
function persist(): void {
  const saved: SavedWindow[] = [...windows.values()].map((w) => ({ roots: w.roots, current: w.current }))
  void session.write(saved)
}

/** Opens a window with these projects (those already open in another window are skipped). */
async function openWindow(roots: readonly string[], current: string | null, resume: string[] = []): Promise<ProjectWindow> {
  const opened = roots.filter((root) => !ownerOf(resolve(root))).flatMap((root) => openProject(root)?.root ?? [])
  const window = createBrowserWindow(opened.length === 0)
  const entry: ProjectWindow = {
    window,
    contents: window.webContents,
    roots: opened,
    current: current && opened.includes(current) ? current : (opened[0] ?? null),
    bridge: createBridge({ version: app.getVersion(), workspaceFolders: () => entry.roots, renderer: window.webContents }),
    resume,
  }
  windows.set(entry.contents.id, entry)
  for (const root of opened) watch(root)
  // Claude Code connects here (/ide); the window's terminals get its CLAUDE_CODE_SSE_PORT, so the
  // bridge has to listen before the renderer starts them.
  try {
    await entry.bridge.start()
  } catch (error) {
    console.error('[anycode] Claude Code bridge failed to start:', error)
  }
  entry.contents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) failPendingToolCalls(entry.contents, 'The AnyCode window reloaded')
  })
  window.on('closed', () => closeWindow(entry))
  loadRenderer(window)
  persist()
  return entry
}

/** Stops what a closed window was running. The last window stays in the session, to reopen next time. */
function closeWindow(entry: ProjectWindow): void {
  windows.delete(entry.contents.id)
  failPendingToolCalls(entry.contents, 'The AnyCode window closed')
  killAllPtys(entry.contents)
  stopAllLanguageServers(entry.contents)
  stopDebugging(entry.contents)
  for (const root of entry.roots) releaseProject(root)
  void entry.bridge.stop()
  if (!quitting && windows.size > 0) persist()
}

function releaseProject(root: string): void {
  agentRoots.delete(root)
  closeProject(root)
  stopEslint(root)
  watchers.get(root)?.()
  watchers.delete(root)
}

function focusWindow(entry: ProjectWindow, root?: string): void {
  if (root) emit(entry.contents, 'project:reveal', root)
  if (headless) return
  if (entry.window.isMinimized()) entry.window.restore()
  entry.window.show()
  entry.window.focus()
}

/** A window that gained its first project grows to a project window; one left without projects shows the Welcome screen. */
function resizeForProjects(entry: ProjectWindow, hadProjects: boolean): void {
  const hasProjects = entry.roots.length > 0
  if (hasProjects === hadProjects || entry.window.isFullScreen()) return
  if (entry.window.isMaximized()) entry.window.unmaximize()
  const size = hasProjects ? PROJECT_SIZE : WELCOME_SIZE
  entry.window.setSize(size.width, size.height)
  entry.window.center()
}

/**
 * The project named on the command line; else the previous session's windows when "Reopen projects
 * on startup" is on; else the Welcome screen.
 */
async function restoreSession(): Promise<void> {
  const saved = explicit ? [{ roots: [explicit], current: explicit }] : currentSettings().system.reopenProjects ? await session.read() : []
  if (saved.length === 0) await openWindow([], null)
  for (const w of saved) await openWindow(w.roots, w.current)
}

async function captureScreenshot(window: BrowserWindow, path: string): Promise<void> {
  const image = await window.webContents.capturePage()
  const target = resolve(path)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, image.toPNG())
  console.log(`[anycode] screenshot saved to ${target}`)
}

/** Agent session command: ANYCODE_AGENT_COMMAND, else the setting ("" = none); headless runs default to none. */
function agentCommand(): string[] | null {
  const configured = process.env.ANYCODE_AGENT_COMMAND ?? (headless ? '' : currentSettings().terminal.agentCommand)
  return configured.trim() ? configured.trim().split(/\s+/) : null
}

handle('app:info', () => ({
  platform: process.platform,
  headless,
  version: app.getVersion(),
  home: homedir(),
  agentCommand: agentCommand(),
  startAgent: !headless && currentSettings().terminal.startAgent,
}))

/** Projects whose agent session is running: moved to another window, their conversation resumes there. */
const agentRoots = new Set<string>()
onSend('project:agentState', (root, running) => {
  if (running) agentRoots.add(root)
  else agentRoots.delete(root)
})
const session = new OpenProjectsStore(join(app.getPath('userData'), 'open-projects.json'))
const recent = new RecentProjectsStore(join(app.getPath('userData'), 'recent-projects.json'))

handleFrom('project:initial', async (sender) => {
  const entry = windowOf(sender)
  if (!entry) return { projects: [], current: null, resume: [] }
  if (entry.current) await recent.touch(entry.current)
  return { projects: entry.roots.map(projectInfo), current: entry.current, resume: entry.resume }
})
onSendFrom('project:activated', (sender, root) => {
  const entry = windowOf(sender)
  if (!entry || !entry.roots.includes(root)) return
  entry.current = root
  persist()
  void recent.touch(root)
})
registerSettingsHandlers(join(app.getPath('userData'), 'settings.json'))
registerFsHandlers()
registerSearchHandlers()
const scratchesDir = join(app.getPath('userData'), 'scratches')
registerScratchHandlers(scratchesDir)
registerGitHandlers()
registerRunHandlers(app.getPath('userData'))
registerEslintHandlers()
registerBridgeHandlers((sender) => windowOf(sender)?.bridge)

// One recursive watcher per open project, reporting to the window that has it open.
const watchers = new Map<string, () => void>()
function watch(root: string): void {
  if (watchers.has(root)) return
  watchers.set(
    root,
    watchProject(root, (paths) => {
      const owner = ownerOf(root)
      if (owner) emit(owner.contents, 'fs:changed', paths)
    }),
  )
}

// Scratch files belong to no project: every window hears about them.
mkdirSync(scratchesDir, { recursive: true })
watchProject(scratchesDir, (paths) => {
  for (const entry of windows.values()) emit(entry.contents, 'fs:changed', paths)
})

// Attach: the project joins the asking window.
handleFrom('project:open', async (sender, path) => {
  const entry = windowOf(sender)
  const opened = openProject(path)
  if (!entry || !opened) return null
  const hadProjects = entry.roots.length > 0
  if (!entry.roots.includes(opened.root)) entry.roots.push(opened.root)
  entry.current = opened.root
  resizeForProjects(entry, hadProjects)
  watch(opened.root)
  await recent.touch(opened.root)
  await entry.bridge.updateWorkspaceFolders()
  persist()
  return opened
})
handleFrom('project:close', async (sender, root) => {
  const entry = windowOf(sender)
  if (!entry) return
  entry.roots = entry.roots.filter((r) => r !== root)
  if (entry.current === root) entry.current = entry.roots[0] ?? null
  releaseProject(root)
  // Its last project closed: the window goes away while others remain, else it shows the Welcome screen.
  if (entry.roots.length === 0 && windows.size > 1) {
    entry.window.close()
    return
  }
  resizeForProjects(entry, true)
  await entry.bridge.updateWorkspaceFolders()
  persist()
})
handleFrom('project:focusIfOpen', (sender, path) => {
  const root = resolve(path)
  const owner = ownerOf(root)
  if (!owner || owner.contents === sender) return false
  focusWindow(owner, root)
  return true
})
handleFrom('project:openWindow', async (_sender, path) => {
  const root = resolve(path)
  const owner = ownerOf(root)
  if (owner) {
    focusWindow(owner, root)
    return true
  }
  try {
    if (!statSync(root).isDirectory()) return false
  } catch {
    return false
  }
  await openWindow([root], root)
  await recent.touch(root)
  return true
})
handleFrom('project:otherWindows', (sender) =>
  [...windows.values()].filter((w) => w.contents !== sender).flatMap((w) => w.roots.map(projectInfo)),
)
onSendFrom('window:cycle', (sender, delta) => {
  const list = [...windows.values()]
  const index = list.findIndex((w) => w.contents === sender)
  const next = list[(index + delta + list.length) % list.length]
  if (next && next.contents !== sender) focusWindow(next)
})
// Merge All Project Windows: the other windows' projects move here as tabs. Their windows close
// without releasing them, so roots, watchers and ESLint stay; terminals and LSPs restart here.
handleFrom('window:mergeAll', async (sender) => {
  const target = windowOf(sender)
  if (!target) return []
  const moved: string[] = []
  for (const other of [...windows.values()]) {
    if (other === target) continue
    moved.push(...other.roots)
    other.roots = []
    other.window.close()
  }
  target.roots.push(...moved)
  await target.bridge.updateWorkspaceFolders()
  persist()
  return moved.map((root) => ({ project: projectInfo(root), resume: agentRoots.has(root) }))
})
handleFrom('project:moveToNewWindow', async (sender, root, resumeAgent) => {
  const entry = windowOf(sender)
  if (!entry?.roots.includes(root)) return false
  entry.roots = entry.roots.filter((r) => r !== root)
  if (entry.current === root) entry.current = entry.roots[0] ?? null
  agentRoots.delete(root)
  await entry.bridge.updateWorkspaceFolders()
  await openWindow([root], root, resumeAgent ? [root] : [])
  return true
})
handle('project:recent', async () => visibleRecent(await recent.read(), readJetBrainsRecent()))
handle('project:forgetRecent', (path) => recent.forget(path))
handleFrom('project:pickFolder', async (sender) => {
  const parent = BrowserWindow.fromWebContents(sender)
  if (headless || !parent) return null
  const result = await dialog.showOpenDialog(parent, { properties: ['openDirectory', 'createDirectory'] })
  return result.canceled ? null : (result.filePaths[0] ?? null)
})
registerPtyHandlers((owner) => windowOf(owner)?.bridge.terminalEnv() ?? {})
registerLspHandlers()
registerDebugHandlers()

let screenshotTaken = false
onSendFrom('app:rendererReady', (sender) => {
  const window = BrowserWindow.fromWebContents(sender)
  if (!window || !screenshotPath || screenshotTaken) return
  screenshotTaken = true
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

/** Sends a menu item's action to the focused window's renderer, which performs it like a shortcut would. */
function menuAction(label: string, actionId: string): MenuItem {
  return new MenuItem({
    label,
    click: (_item, window) => {
      const target = window instanceof BrowserWindow ? window : BrowserWindow.getFocusedWindow()
      if (target) emit(target.webContents, 'menu:action', actionId)
    },
  })
}

/**
 * IntelliJ's Window menu on macOS: Electron's default menu, with Merge All Project Windows and Move
 * Tab to New Window added to its Window submenu. No accelerators: shortcuts stay with the keymap.
 */
function installApplicationMenu(): void {
  const menu = Menu.getApplicationMenu()
  const windowMenu = menu?.items.find((item) => item.role?.toLowerCase() === 'windowmenu')?.submenu
  if (!menu || !windowMenu) return
  windowMenu.append(new MenuItem({ type: 'separator' }))
  windowMenu.append(menuAction('Merge All Project Windows', 'MergeAllWindowsAction'))
  windowMenu.append(menuAction('Move Tab to New Window', 'AnyCode.MoveTabToNewWindow'))
  Menu.setApplicationMenu(menu)
}

void app.whenReady().then(async () => {
  if (process.platform === 'darwin') installApplicationMenu()
  // Before any terminal, language server or build starts: they all need the user's PATH.
  await adoptShellEnv(userShell())
  await restoreSession()
})

app.on('before-quit', () => {
  quitting = true
  killAllPtys()
  stopAllLanguageServers()
  stopDebugging()
  stopAllEslint()
})
app.on('will-quit', () => {
  for (const stop of watchers.values()) stop()
  for (const entry of windows.values()) entry.bridge.disposeSync()
})
// Closing the last window quits, on macOS too (the user's choice): no app left in the Dock without windows.
app.on('window-all-closed', () => app.quit())
