import { symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { gotoFile, launch, type Fixture } from './app'

// The project's own ESLint: this repository's node_modules (ESLint 10) linked into the temporary
// project, with a minimal flat configuration.
let fixture: Fixture

test.beforeEach(async () => {
  fixture = await launch({
    setup: async (root) => {
      await symlink(join(process.cwd(), 'node_modules'), join(root, 'node_modules'))
      await writeFile(join(root, 'eslint.config.mjs'), "export default [{ files: ['**/*.js'], rules: { 'no-var': 'error', 'prefer-const': 'warn' } }]\n")
      await writeFile(join(root, 'src', 'app.js'), 'var greeting = "hi"\nlet name = "you"\nconsole.log(greeting, name)\n')
    },
  })
})

test.afterEach(async () => {
  await fixture.close()
})

test('ESLint problems show in the editor and in Problems, and Fix ESLint Problems applies the fixes', async () => {
  const { page } = fixture
  await gotoFile(page, 'app.js')
  await page.locator('.stripe-button[title^="Problems"]').click()
  const problems = page.getByRole('tree', { name: 'Problems' })
  await expect(problems).toContainText('ESLint: Unexpected var, use let or const instead. (no-var)', { timeout: 20_000 })
  await expect(problems).toContainText("ESLint: 'name' is never reassigned. Use 'const' instead. (prefer-const)")

  await page.locator('.editor-pane .monaco-editor .view-lines').click()
  await page.keyboard.press('Meta+Shift+KeyA')
  await page.keyboard.type('Fix ESLint Problems')
  await page.keyboard.press('Enter')
  const editor = page.locator('.editor-pane .monaco-editor .view-lines')
  await expect(editor).toContainText('const greeting = "hi"')
  await expect(editor).toContainText('const name = "you"')
  await expect(page.locator('[data-tool-window="Problems View"]')).not.toContainText('ESLint')
  // One undoable edit, like IntelliJ's.
  await page.locator('.editor-pane .monaco-editor .view-lines').click()
  await page.keyboard.press('Meta+KeyZ')
  await expect(editor).toContainText('var greeting = "hi"')
})

test('projects without an ESLint configuration stay quiet', async () => {
  const { page } = fixture
  await gotoFile(page, 'greeting.ts')
  await page.locator('.stripe-button[title^="Problems"]').click()
  await page.waitForTimeout(1500)
  await expect(page.locator('[data-tool-window="Problems View"]')).not.toContainText('ESLint')
})
