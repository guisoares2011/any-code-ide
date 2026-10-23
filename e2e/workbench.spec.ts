import { expect, test } from '@playwright/test'
import { launch, type Fixture } from './app'

let fixture: Fixture

test.beforeEach(async () => {
  fixture = await launch()
})

test.afterEach(async () => {
  await fixture.close()
})

test('shows the Islands layout with the project tree and the terminal', async () => {
  const { page } = fixture
  await expect(page.getByRole('tree', { name: 'Project' })).toContainText('src')
  await expect(page.locator('.tool-window-title', { hasText: 'Terminal' })).toBeVisible()
  const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  expect(background).toBe('rgb(38, 40, 44)') // container-main-window-bg #26282C
})

test('Go to File (⇧⌘O) opens a file in the editor', async () => {
  const { page } = fixture
  await page.keyboard.press('Meta+Shift+KeyO')
  await expect(page.getByRole('dialog', { name: 'Files' })).toBeVisible()
  await page.keyboard.type('greet')
  await expect(page.locator('.popup-item').first()).toContainText('greeting.ts')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('tab', { name: /greeting\.ts/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.monaco-editor .view-lines')).toContainText('Hello')
})

test('Find Action (⇧⌘A) lists registered actions with their shortcuts', async () => {
  const { page } = fixture
  await page.keyboard.press('Meta+Shift+KeyA')
  await expect(page.getByRole('dialog', { name: 'Actions' })).toBeVisible()
  await page.keyboard.type('go to file')
  const item = page.locator('.popup-item').first()
  await expect(item).toContainText('Go to File')
  await expect(item.locator('.shortcut')).toHaveText('⇧⌘O')
})

test('the terminal runs a shell in the project root', async () => {
  const { page, project } = fixture
  await page.locator('.terminal-host').click()
  await page.keyboard.type('pwd\n')
  await expect(page.locator('.terminal-host .xterm-rows')).toContainText(project.split('/').pop()!)
})

test('the process sees the terminal size from its first frame (full-screen programs like claude)', async () => {
  const { page } = fixture
  await page.locator('.terminal-host').click()
  await page.keyboard.type('stty size\n')
  const rows = page.locator('.terminal-host .xterm-rows > div')
  const expected = await rows.count()
  await expect
    .poll(async () => (await rows.allInnerTexts()).map((r) => r.replace(/\u00a0/g, ' ').trim()).find((r) => /^\d+ \d+$/.test(r)))
    .toMatch(new RegExp(`^${expected} \\d+$`))
})

test('Run executes a package.json script and reports the exit code', async () => {
  const { page } = fixture
  await expect(page.locator('.main-toolbar')).toContainText('hello')
  await page.keyboard.press('Control+KeyR')
  await expect(page.locator('.tool-window-title', { hasText: 'Run' })).toBeVisible()
  await expect(page.locator('[data-tool-window="Run"] .xterm-rows')).toContainText('hello from run')
  await expect(page.locator('[data-tool-window="Run"] .xterm-rows')).toContainText('exit code 0')
})

test('⌘1 toggles the Project tool window like ActivateProjectToolWindow', async () => {
  const { page } = fixture
  await page.getByRole('tree', { name: 'Project' }).focus()
  await page.keyboard.press('Meta+Digit1')
  await expect(page.getByRole('tree', { name: 'Project' })).toBeHidden()
  await page.keyboard.press('Meta+Digit1')
  await expect(page.getByRole('tree', { name: 'Project' })).toBeVisible()
})
