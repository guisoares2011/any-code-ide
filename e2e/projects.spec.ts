import { rm } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
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

test('opens a second project in the same window, each with its own tabs and terminal', async () => {
  const { page, project } = fixture
  const toolbar = page.locator('.main-toolbar')
  const terminalRows = page.locator('.terminal-host .xterm-rows')

  // A file and a terminal command in the first project.
  await page.keyboard.press('Meta+Shift+KeyO')
  await expect(page.getByRole('dialog', { name: 'Files' })).toBeVisible()
  await page.keyboard.type('README.md')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('tab', { name: /README\.md/ })).toBeVisible()
  await page.locator('.terminal-host').click()
  await page.keyboard.type('echo first-project-marker\n')
  await expect(terminalRows).toContainText('first-project-marker')

  // Open the second project from the project widget by typing its path.
  await toolbar.getByRole('button', { name: name(project) }).click()
  await expect(page.getByRole('dialog', { name: 'Projects' })).toContainText('Open Projects')
  await page.keyboard.type(second)
  await page.keyboard.press('Enter')
  await expect(toolbar).toContainText(name(second))
  await expect(page.getByRole('tree', { name: 'Project' })).toContainText(name(second))
  await expect(page.getByRole('tab', { name: /README\.md/ })).toHaveCount(0)
  await page.locator('.terminal-host').click()
  await page.keyboard.type('pwd\n')
  await expect(terminalRows).toContainText(name(second))
  await expect(terminalRows).not.toContainText('first-project-marker')

  // Claude sees both projects in the lock file / getWorkspaceFolders.
  const claude = await FakeClaude.connect(fixture.claudeConfigDir)
  const folders = JSON.parse((await claude.call('getWorkspaceFolders'))[0]!) as { folders: { path: string }[] }
  expect(folders.folders.map((f) => f.path).sort()).toEqual([project, second].sort())
  claude.close()

  // Back to the first project with ⌥⌘` (PreviousProjectWindow/NextProjectWindow cycle).
  await page.keyboard.press('Meta+Alt+Backquote')
  await expect(toolbar).toContainText(name(project))
  await expect(page.getByRole('tab', { name: /README\.md/ })).toBeVisible()
  await expect(terminalRows).toContainText('first-project-marker')
})

test('Close Project returns to the remaining project', async () => {
  const { page, project } = fixture
  await page.locator('.main-toolbar').getByRole('button', { name: name(project) }).click()
  await page.keyboard.type(second)
  await page.keyboard.press('Enter')
  await expect(page.locator('.main-toolbar')).toContainText(name(second))

  await page.keyboard.press('Meta+Shift+KeyA')
  await expect(page.getByRole('dialog', { name: 'Actions' })).toBeVisible()
  await page.keyboard.type('Close Project')
  await expect(page.locator('.popup-item').first()).toContainText('Close Project')
  await page.keyboard.press('Enter')
  await expect(page.locator('.main-toolbar')).toContainText(name(project))
  await expect(page.locator('.main-toolbar')).not.toContainText(name(second))
})
