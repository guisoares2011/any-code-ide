import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { gotoFile, launch, type Fixture } from './app'

let fixture: Fixture

test.beforeEach(async () => {
  fixture = await launch()
})

test.afterEach(async () => {
  await fixture.close()
})

test('⌘, opens Settings; the editor font changes live and is saved', async () => {
  const { page } = fixture
  await gotoFile(page, 'greeting.ts')
  const line = page.locator('.editor-pane .monaco-editor .view-line').first()
  await expect(line).toHaveCSS('height', '20px')

  await page.keyboard.press('Meta+Comma') // ShowSettings
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Editor › Font')).toBeVisible()
  await dialog.getByLabel('Line height (px)').fill('26')
  await dialog.getByRole('button', { name: 'Apply' }).click()
  await expect(line).toHaveCSS('height', '26px')
  await dialog.getByRole('button', { name: 'OK' }).click()
  await expect(dialog).toBeHidden()

  const saved = JSON.parse(await readFile(join(fixture.userData, 'settings.json'), 'utf8')) as { editor: { lineHeight: number } }
  expect(saved.editor.lineHeight).toBe(26)
})

test('the search finds pages, and the Keymap page lists shortcuts', async () => {
  const { page } = fixture
  await page.getByRole('button', { name: 'Settings' }).click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await expect(dialog.getByRole('textbox', { name: 'Search settings' })).toBeFocused()
  await page.keyboard.type('agent')
  await expect(dialog.getByRole('tree', { name: 'Settings pages' }).getByRole('treeitem')).toHaveCount(1)
  await expect(dialog.getByText('Tools › Terminal')).toBeVisible()
  await expect(dialog.getByLabel('Agent command')).toHaveValue('claude')

  await dialog.getByRole('textbox', { name: 'Search settings' }).fill('')
  await dialog.getByRole('treeitem', { name: 'Keymap' }).click()
  await dialog.getByRole('textbox', { name: 'Search keymap' }).fill('meta K')
  const keymap = dialog.getByRole('table', { name: 'Keymap' })
  await expect(keymap.getByRole('row', { name: /Commit/ }).first()).toContainText('⌘K')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})
