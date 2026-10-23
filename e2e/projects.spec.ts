import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { createProject, launch, type Fixture } from './app'
import { FakeClaude } from './claudeClient'

let fixture: Fixture
let second: string

test.beforeEach(async () => {
  fixture = await launch()
  second = await createProject()
})

test.afterEach(async () => {
  await fixture.close()
  await rm(second, { recursive: true, force: true })
})

const name = (path: string): string => path.split('/').pop()!

test('New Tab opens a project tab: each tab keeps its own editor tabs and terminal', async () => {
  const { page, project } = fixture
  const toolbar = page.locator('.main-toolbar')
  const terminalRows = page.locator('.terminal-host .xterm-rows')
  const projectTabs = page.getByRole('tablist', { name: 'Projects' })
  const editorTabs = page.locator('.editor-tabs')

  // A file and a terminal command in the first project; one project shows no project tabs.
  await page.keyboard.press('Meta+Shift+KeyO')
  await expect(page.getByRole('dialog', { name: 'Files' })).toBeVisible()
  await page.keyboard.type('README.md')
  await page.keyboard.press('Enter')
  await expect(editorTabs.getByRole('tab', { name: /README\.md/ })).toBeVisible()
  await page.locator('.terminal-host').click()
  await page.keyboard.type('echo first-project-marker\n')
  await expect(terminalRows).toContainText('first-project-marker')
  await expect(projectTabs).toHaveCount(0)

  // Open the second project from the project widget by typing its path.
  await toolbar.getByRole('button', { name: name(project) }).click()
  await expect(page.getByRole('dialog', { name: 'Projects' })).toContainText('Open Projects')
  await page.keyboard.type(second)
  await page.keyboard.press('Enter')
  // IntelliJ's "Open Project" question; Enter is New Tab.
  const dialog = page.getByRole('dialog', { name: 'Open Project' })
  await expect(dialog).toContainText(name(second))
  await page.keyboard.press('Enter')
  await expect(dialog).toHaveCount(0)
  await expect(toolbar).toContainText(name(second))

  // Two project tabs, the new one selected; its editor tabs, tree and terminal are its own.
  await expect(projectTabs.getByRole('tab')).toHaveCount(2)
  await expect(projectTabs.getByRole('tab', { selected: true })).toContainText(name(second))
  await expect(projectTabs.getByRole('tab', { name: `${name(project)} – README.md` })).toBeVisible()
  await expect(page.getByRole('tree', { name: 'Project' })).toContainText(name(second))
  await expect(editorTabs.getByRole('tab', { name: /README\.md/ })).toHaveCount(0)
  await page.locator('.terminal-host').click()
  await page.keyboard.type('pwd\n')
  await expect(terminalRows).toContainText(name(second))
  await expect(terminalRows).not.toContainText('first-project-marker')

  // Claude sees both projects in the lock file / getWorkspaceFolders.
  const claude = await FakeClaude.connect(fixture.claudeConfigDir)
  const folders = JSON.parse((await claude.call('getWorkspaceFolders'))[0]!) as { folders: { path: string }[] }
  expect(folders.folders.map((f) => f.path).sort()).toEqual([project, second].sort())
  claude.close()

  // Back to the first tab: its file and terminal are as they were.
  await projectTabs.getByRole('tab', { name: new RegExp(`^${name(project)}`) }).click()
  await expect(toolbar).toContainText(name(project))
  await expect(editorTabs.getByRole('tab', { name: /README\.md/ })).toBeVisible()
  await expect(terminalRows).toContainText('first-project-marker')

  // ⌥⌘` (NextProjectWindow) cycles the tabs; closing a tab leaves a single project without tabs.
  await page.keyboard.press('Meta+Alt+Backquote')
  await expect(toolbar).toContainText(name(second))
  await projectTabs.getByRole('button', { name: `Close ${name(second)}` }).click()
  await expect(projectTabs).toHaveCount(0)
  await expect(toolbar).toContainText(name(project))
})

test('Merge All Project Windows brings other windows in as tabs, and Move Tab to New Window takes one out', async () => {
  const { app, page, project } = fixture
  await page.locator('.main-toolbar').getByRole('button', { name: name(project) }).click()
  await page.keyboard.type(second)
  await page.keyboard.press('Enter')
  const opened = app.waitForEvent('window')
  await page.getByRole('dialog', { name: 'Open Project' }).getByRole('button', { name: 'New Window' }).click()
  const other = await opened
  await other.waitForSelector('.workbench')
  await expect(other.locator('.main-toolbar')).toContainText(name(second))

  const findAction = async (text: string): Promise<void> => {
    await page.locator('.editor-area, .workbench-body').first().click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('Meta+Shift+KeyA')
    await page.keyboard.type(text)
    await expect(page.locator('.popup-item').first()).toContainText(text)
    await page.keyboard.press('Enter')
  }

  await findAction('Merge All Project Windows')
  await expect.poll(() => app.windows().length).toBe(1)
  const projectTabs = page.getByRole('tablist', { name: 'Projects' })
  await expect(projectTabs.getByRole('tab')).toHaveCount(2)
  // The shown tab stays; the merged project's terminal starts in this window.
  await expect(page.locator('.main-toolbar')).toContainText(name(project))
  await projectTabs.getByRole('tab', { name: new RegExp(`^${name(second)}`) }).click()
  await page.locator('.terminal-host').click()
  await page.keyboard.type('pwd\n')
  await expect(page.locator('.terminal-host .xterm-rows')).toContainText(name(second))

  const moved = app.waitForEvent('window')
  await findAction('Move Tab to New Window')
  const again = await moved
  await again.waitForSelector('.workbench')
  await expect(again.locator('.main-toolbar')).toContainText(name(second))
  await expect(projectTabs).toHaveCount(0)
  await expect(page.locator('.main-toolbar')).toContainText(name(project))
})

test('Close Project returns to the remaining project', async () => {
  const { page, project } = fixture
  await page.locator('.main-toolbar').getByRole('button', { name: name(project) }).click()
  await page.keyboard.type(second)
  await page.keyboard.press('Enter')
  await page.getByRole('dialog', { name: 'Open Project' }).getByRole('button', { name: 'New Tab' }).click()
  await expect(page.locator('.main-toolbar')).toContainText(name(second))

  await page.keyboard.press('Meta+Shift+KeyA')
  await expect(page.getByRole('dialog', { name: 'Actions' })).toBeVisible()
  await page.keyboard.type('Close Project')
  await expect(page.locator('.popup-item').first()).toContainText('Close Project')
  await page.keyboard.press('Enter')
  await expect(page.locator('.main-toolbar')).toContainText(name(project))
  await expect(page.locator('.main-toolbar')).not.toContainText(name(second))
})

test('"This Window" replaces the current project', async () => {
  const { page, project } = fixture
  const toolbar = page.locator('.main-toolbar')
  await toolbar.getByRole('button', { name: name(project) }).click()
  await page.keyboard.type(second)
  await page.keyboard.press('Enter')
  await page.getByRole('dialog', { name: 'Open Project' }).getByRole('button', { name: 'This Window' }).click()
  await expect(toolbar).toContainText(name(second))
  // Only one project is left open, so the project switcher has nothing to cycle to.
  await page.keyboard.press('Meta+Alt+Backquote')
  await expect(toolbar).toContainText(name(second))
  await expect(toolbar).not.toContainText(name(project))
})

test('New Window opens the project in its own window, with its own Claude Code lock file', async () => {
  const { app, page, project } = fixture
  await page.locator('.main-toolbar').getByRole('button', { name: name(project) }).click()
  await page.keyboard.type(second)
  await page.keyboard.press('Enter')
  const opened = app.waitForEvent('window')
  await page.getByRole('dialog', { name: 'Open Project' }).getByRole('button', { name: 'New Window' }).click()
  const other = await opened
  await other.waitForSelector('.workbench')
  await expect(other.locator('.main-toolbar')).toContainText(name(second))
  await expect(page.locator('.main-toolbar')).toContainText(name(project))
  await expect(page.locator('.main-toolbar')).not.toContainText(name(second))
  await other.locator('.terminal-host').click()
  await other.keyboard.type('pwd\n')
  await expect(other.locator('.terminal-host .xterm-rows')).toContainText(name(second))

  // One bridge per window: each lock file lists only that window's project.
  const dir = join(fixture.claudeConfigDir, 'ide')
  await expect
    .poll(async () => {
      const locks = (await readdir(dir)).filter((f) => f.endsWith('.lock'))
      const folders = await Promise.all(locks.map(async (f) => (JSON.parse(await readFile(join(dir, f), 'utf8')) as { workspaceFolders: string[] }).workspaceFolders))
      return folders.map((f) => f.join(',')).sort()
    })
    .toEqual([project, second].sort())

  // Opening it again from the first window brings the second window forward instead of asking.
  await page.locator('.main-toolbar').getByRole('button', { name: name(project) }).click()
  const popup = page.getByRole('dialog', { name: 'Projects' })
  await expect(popup.locator('.popup-item', { hasText: 'other window' })).toContainText(name(second))
  await popup.locator('.popup-item', { hasText: 'other window' }).click()
  await expect(page.getByRole('dialog', { name: 'Open Project' })).toHaveCount(0)
  expect(app.windows()).toHaveLength(2)

  // Closing the second window leaves the first one running.
  await other.close()
  await expect.poll(async () => (await readdir(dir)).filter((f) => f.endsWith('.lock')).length).toBe(1)
  await expect(page.locator('.main-toolbar')).toContainText(name(project))
})

test('a start from the Dock reopens every window of the previous session', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'anycode-userdata-'))
  const claudeConfigDir = await mkdtemp(join(tmpdir(), 'anycode-claude-'))
  await writeFile(join(userData, 'open-projects.json'), JSON.stringify({ windows: [{ roots: [fixture.project], current: fixture.project }, { roots: [second], current: second }] }))
  // cwd "/" and no --project: what the Dock does.
  const app = await electron.launch({
    args: [resolve('out/main/index.js')],
    cwd: '/',
    env: { ...process.env, ANYCODE_HEADLESS: '1', ANYCODE_AGENT_COMMAND: '', CLAUDE_CONFIG_DIR: claudeConfigDir, ANYCODE_USER_DATA: userData },
  })
  await expect.poll(() => app.windows().length).toBe(2)
  const toolbars = await Promise.all(
    app.windows().map(async (w) => {
      await w.waitForSelector('.main-toolbar .toolbar-widget')
      return w.locator('.main-toolbar .toolbar-widget').first().innerText()
    }),
  )
  const names = toolbars.map((t) => t.split('\n').pop()!.trim())
  expect(names.sort()).toEqual([name(fixture.project), name(second)].sort())
  await app.close()
  await rm(userData, { recursive: true, force: true })
  await rm(claudeConfigDir, { recursive: true, force: true })
})
