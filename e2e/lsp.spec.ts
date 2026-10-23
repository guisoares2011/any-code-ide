import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launch, type Fixture } from './app'
import { FakeClaude } from './claudeClient'

let fixture: Fixture

test.beforeEach(async () => {
  fixture = await launch()
})

test.afterEach(async () => {
  await fixture.close()
})

async function openFile(name: string): Promise<void> {
  const { page } = fixture
  await page.keyboard.press('Meta+Shift+KeyO')
  await expect(page.getByRole('dialog', { name: 'Files' })).toBeVisible()
  await page.keyboard.type(name)
  await expect(page.locator('.popup-item').first()).toContainText(name)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('tab', { name: new RegExp(name.replace('.', '\\.')) })).toHaveAttribute('aria-selected', 'true')
}

test('typescript-go reports type errors in Problems and to Claude through getDiagnostics', async () => {
  const { page } = fixture
  await openFile('main.ts')
  await page.locator('.stripe-button[title^="Problems"]').click()
  await expect(page.getByRole('tree', { name: 'Problems' })).toContainText("is not assignable to type 'number'", { timeout: 20_000 })

  const claude = await FakeClaude.connect(fixture.claudeConfigDir)
  const uri = `file://${join(fixture.project, 'src', 'main.ts')}`
  const reports = JSON.parse((await claude.call('getDiagnostics', { uri }))[0]!) as { diagnostics: { severity: string; message: string }[] }[]
  expect(reports[0]?.diagnostics).toEqual([expect.objectContaining({ severity: 'Error', message: expect.stringContaining('number') })])
  claude.close()
})

test('Go to Declaration (⌘B) opens the definition in another file', async () => {
  const { page } = fixture
  await openFile('main.ts')
  await expect(page.locator('.status-bar')).toContainText('main.ts')
  // Wait for the server to answer something before navigating.
  await page.locator('.stripe-button[title^="Problems"]').click()
  await expect(page.getByRole('tree', { name: 'Problems' })).toContainText('number', { timeout: 20_000 })
  // Line 3 is `export const count: number = greeting('AnyCode')`; column 31 is inside `greeting`.
  await page.locator('.monaco-editor .view-lines').click()
  await page.keyboard.press('Meta+KeyL') // GotoLine
  await page.keyboard.type('3:31')
  await page.keyboard.press('Enter')
  await expect(page.locator('.status-bar')).toContainText('3:31')
  await page.keyboard.press('Meta+KeyB') // GotoDeclaration
  await expect(page.getByRole('tab', { name: /greeting\.ts/ })).toHaveAttribute('aria-selected', 'true', { timeout: 10_000 })
})

test('Structure lists the symbols of the active file', async () => {
  const { page } = fixture
  await openFile('greeting.ts')
  await page.locator('.stripe-button[title^="Structure"]').click()
  await expect(page.getByRole('tree', { name: 'Structure' })).toContainText('greeting', { timeout: 20_000 })
})
