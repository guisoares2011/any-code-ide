import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { gotoFile, launch, type Fixture } from './app'

let fixture: Fixture

test.beforeEach(async () => {
  fixture = await launch({
    git: true,
    setup: async (root) => {
      await writeFile(join(root, 'src', 'notes.md'), 'greeting in a note\nGreetings are case-insensitive by default\n')
    },
  })
})

test.afterEach(async () => {
  await fixture.close()
})

test('⇧⌘F finds text in the project, with Words, Match case and the file mask, and opens the match', async () => {
  const { page } = fixture
  await page.keyboard.press('Meta+Shift+KeyF')
  const popup = page.getByRole('dialog', { name: 'Find in Files' })
  await expect(popup.getByRole('textbox', { name: 'Search text' })).toBeFocused()
  await page.keyboard.type('greeting')
  // greeting.ts (the declaration), main.ts (import, path and call), notes.md (2).
  const results = popup.getByRole('option')
  await expect(popup.locator('.find-summary')).toHaveText(/6 matches in 3 files/)
  await expect(results).toHaveCount(6)

  // ⌥W: whole words only drops "Greetings"; ⌥C: match case drops nothing else here.
  await page.keyboard.press('Alt+KeyW')
  await expect(popup.locator('.find-summary')).toHaveText(/5 matches in 3 files/)
  await page.keyboard.press('Alt+KeyC')
  await expect(popup.locator('.find-summary')).toHaveText(/5 matches in 3 files/)
  await popup.getByRole('textbox', { name: 'Search text' }).fill('Greeting')
  await expect(popup.locator('.find-summary')).toHaveText('No matches')
  await page.keyboard.press('Alt+KeyC')
  await page.keyboard.press('Alt+KeyW')

  await popup.getByPlaceholder('*.ts, !*.test.ts').fill('*.md')
  await expect(popup.locator('.find-summary')).toHaveText(/2 matches in 1 file$/)
  await expect(results.first()).toContainText('greeting in a note')
  await expect(popup.locator('.find-preview .view-lines')).toContainText('greeting in a note')

  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(popup).toBeHidden()
  await expect(page.getByRole('tab', { name: /notes\.md/ })).toHaveAttribute('aria-selected', 'true')
})

test('Find in Files sees unsaved edits of open documents', async () => {
  const { page } = fixture
  await gotoFile(page, 'greeting.ts')
  await page.locator('.editor-pane .monaco-editor .view-lines').click()
  await page.keyboard.press('Meta+ArrowDown')
  await page.keyboard.type('// unsavedMarker\n')
  await page.keyboard.press('Meta+Shift+KeyF')
  const popup = page.getByRole('dialog', { name: 'Find in Files' })
  await page.keyboard.type('unsavedMarker')
  await expect(popup.locator('.find-summary')).toHaveText(/1 match in 1 file/)
  await expect(popup.getByRole('option').first()).toContainText('greeting.ts')
})

test('⇧⌘R replaces in every file, after confirmation', async () => {
  const { page, project } = fixture
  await page.keyboard.press('Meta+Shift+KeyR')
  const popup = page.getByRole('dialog', { name: 'Replace in Files' })
  await page.keyboard.type('Hello')
  // package.json's "hello" script matches too until Match case (⌥C) is on.
  await expect(popup.locator('.find-summary')).toHaveText(/3 matches in 2 files/)
  await page.keyboard.press('Alt+KeyC')
  await expect(popup.locator('.find-summary')).toHaveText(/1 match in 1 file/)
  await popup.getByRole('textbox', { name: 'Replacement' }).fill('Hi')
  await popup.getByRole('button', { name: 'Replace All' }).click()
  await page.getByRole('dialog', { name: 'Replace All' }).getByRole('button', { name: 'Replace' }).click()
  await expect.poll(() => readFile(join(project, 'src', 'greeting.ts'), 'utf8')).toContain('`Hi, ${name}`')
  await expect(popup.locator('.find-summary')).toHaveText('No matches')
})
