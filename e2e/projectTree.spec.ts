import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { gotoFile, launch, type Fixture } from './app'

let fixture: Fixture

test.beforeEach(async () => {
  fixture = await launch({
    setup: async (root) => {
      await mkdir(join(root, 'app', 'src', 'main', 'java', 'com', 'acme'), { recursive: true })
      await writeFile(join(root, 'hello.sh'), 'echo "hello from script"\n')
    },
  })
})

test.afterEach(async () => {
  await fixture.close()
})

const row = (page: Page, name: string) => page.getByRole('treeitem').filter({ has: page.locator(`span:text-is("${name}")`) })
const menuItem = (page: Page, label: string) => page.getByRole('menuitem', { name: label, exact: false }).filter({ hasText: new RegExp(`^${label}`) })

async function expand(page: Page, ...names: string[]): Promise<void> {
  for (const name of names) {
    const item = row(page, name).first()
    if ((await item.getAttribute('aria-expanded')) !== 'true') await item.click()
  }
}

test('New › File from the context menu creates the file (with subdirectories) and opens it', async () => {
  const { page, project } = fixture
  await row(page, 'src').click({ button: 'right' })
  await expect(page.getByRole('menu')).toBeVisible()
  await menuItem(page, 'New').hover()
  await menuItem(page, 'File').click()
  const dialog = page.getByRole('dialog', { name: 'New File' })
  await dialog.getByRole('textbox').fill('util/strings.ts')
  await page.keyboard.press('Enter')
  await expect(page.locator('.editor-tab.selected')).toContainText('strings.ts')
  expect(existsSync(join(project, 'src', 'util', 'strings.ts'))).toBe(true)

  // An existing name is refused in the dialog.
  await row(page, 'src').click({ button: 'right' })
  await menuItem(page, 'New').hover()
  await menuItem(page, 'File').click()
  await page.getByRole('dialog', { name: 'New File' }).getByRole('textbox').fill('main.ts')
  await page.keyboard.press('Enter')
  await expect(page.locator('.field-error')).toHaveText("'main.ts' already exists")
  await page.keyboard.press('Escape')
})

test('New › Java Class in a source root writes the package and the class', async () => {
  const { page, project } = fixture
  await expand(page, 'app', 'src', 'main')
  await row(page, 'java').click({ button: 'right' })
  await menuItem(page, 'New').hover()
  await expect(menuItem(page, 'Package')).toBeVisible()
  await menuItem(page, 'Java Class').click()
  const dialog = page.getByRole('dialog', { name: 'New Java Class' })
  await dialog.getByRole('textbox').fill('com.acme.Greeter')
  await page.keyboard.press('ArrowDown') // Interface
  await page.keyboard.press('Enter')
  const path = join(project, 'app', 'src', 'main', 'java', 'com', 'acme', 'Greeter.java')
  await expect.poll(() => existsSync(path)).toBe(true)
  expect(await readFile(path, 'utf8')).toBe('package com.acme;\n\npublic interface Greeter {\n}\n')
  await expect(page.locator('.editor-tab.selected')).toContainText('Greeter.java')
})

test('Rename (⇧F6) moves the open tab along; Delete (⌫) asks and removes the file', async () => {
  const { page, project } = fixture
  await expand(page, 'src')
  await gotoFile(page, 'greeting.ts')
  await row(page, 'greeting.ts').click()
  await page.keyboard.press('Shift+F6')
  const field = page.getByRole('dialog', { name: 'Rename File' }).getByRole('textbox')
  // The name is selected without its extension.
  await page.keyboard.type('salutation')
  await expect(field).toHaveValue('salutation.ts')
  await page.keyboard.press('Enter')
  await expect(row(page, 'salutation.ts')).toBeVisible()
  expect(existsSync(join(project, 'src', 'salutation.ts'))).toBe(true)
  await expect(page.locator('.editor-tab.selected')).toContainText('salutation.ts')

  await row(page, 'salutation.ts').click()
  await page.keyboard.press('Backspace')
  await expect(page.getByRole('dialog', { name: 'Delete' })).toContainText("Delete file 'salutation.ts'?")
  await page.keyboard.press('Enter')
  await expect(row(page, 'salutation.ts')).toHaveCount(0)
  expect(existsSync(join(project, 'src', 'salutation.ts'))).toBe(false)
  await expect(page.locator('.editor-tab', { hasText: 'salutation.ts' })).toHaveCount(0)
})

test('Copy and Paste in the tree duplicate a file; Cut and Paste move it', async () => {
  const { page, project } = fixture
  await expand(page, 'src')
  await row(page, 'main.ts').click()
  await page.keyboard.press('Meta+KeyC')
  // Pasting on a file puts the copy in its directory.
  await row(page, 'greeting.ts').click()
  await page.keyboard.press('Meta+KeyV')
  await expect(row(page, 'main copy.ts')).toBeVisible()

  await row(page, 'README.md').click()
  await page.keyboard.press('Meta+KeyX')
  await expect(row(page, 'README.md')).toHaveClass(/cut/)
  await row(page, 'greeting.ts').click()
  await page.keyboard.press('Meta+KeyV')
  await expect.poll(() => existsSync(join(project, 'src', 'README.md'))).toBe(true)
  expect(existsSync(join(project, 'README.md'))).toBe(false)
})

test('Run from the context menu runs a script in the Run tool window', async () => {
  const { page } = fixture
  await row(page, 'hello.sh').click({ button: 'right' })
  await menuItem(page, "Run 'hello.sh'").click()
  const output = page.locator('[data-tool-window="Run"] .terminal-session:visible .xterm-rows')
  await expect(output).toContainText('hello from script')
})

test('the context menu works from the keyboard: arrows, → into a submenu, Enter', async () => {
  const { page } = fixture
  await row(page, 'src').click()
  await page.keyboard.press('Meta+KeyN') // NewElement: the New menu under the selection
  await expect(page.getByRole('menu')).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown') // File, Scratch File, Directory
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: 'New Directory' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'New Directory' })).toHaveCount(0)

  await row(page, 'src').click({ button: 'right' })
  await page.keyboard.press('ArrowDown') // New
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('menu')).toHaveCount(2)
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByRole('menu')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
})

test('New Scratch File (⇧⌘N) creates scratch.<ext> outside the project, listed under Scratches', async () => {
  const { page, project, userData } = fixture
  await page.locator('[data-tool-window="Project"] .tree').click()
  await page.keyboard.press('Meta+Shift+KeyN')
  const popup = page.getByRole('dialog', { name: 'New Scratch File' })
  await popup.getByRole('textbox').fill('json')
  await page.keyboard.press('Enter')
  await expect(page.locator('.editor-tab.selected')).toContainText('scratch.json')
  expect(await readdir(join(userData, 'scratches'))).toEqual(['scratch.json'])
  expect(existsSync(join(project, 'scratch.json'))).toBe(false)

  // Typing and saving writes the scratch file.
  await page.locator('.editor-pane .monaco-editor .view-lines').click()
  await page.keyboard.type('{"a": 1}')
  await page.keyboard.press('Meta+KeyS')
  await expect.poll(() => readFile(join(userData, 'scratches', 'scratch.json'), 'utf8')).toContain('"a": 1')

  await expand(page, 'Scratches and Consoles', 'Scratches')
  await expect(row(page, 'scratch.json')).toBeVisible()

  // A second one gets the next name.
  await page.keyboard.press('Meta+Shift+KeyN')
  await page.getByRole('dialog', { name: 'New Scratch File' }).getByRole('textbox').fill('json')
  await page.keyboard.press('Enter')
  await expect(page.locator('.editor-tab.selected')).toContainText('scratch_1.json')
  await expect(row(page, 'scratch_1.json')).toBeVisible()
})
