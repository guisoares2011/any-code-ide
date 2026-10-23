import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launch, type Fixture } from './app'

const kotlinInstalled = existsSync(join(homedir(), 'Library', 'Application Support', 'AnyCode', 'language-servers', 'kotlin'))
test.skip(!kotlinInstalled, 'kotlin-lsp not installed (node scripts/install-language-servers.mjs kotlin)')
// The Kotlin server is an IntelliJ-based process; the first start indexes the JDK.
test.setTimeout(180_000)

let fixture: Fixture

test.beforeEach(async () => {
  fixture = await launch()
  const dir = join(fixture.project, 'src', 'main', 'kotlin', 'demo')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'Greeter.kt'), 'package demo\n\nclass Greeter {\n    fun greet(name: String): String = "Hello, $name"\n}\n')
})

test.afterEach(async () => {
  await fixture.close()
})

// kotlin-lsp analyzes only Gradle/Maven projects; this throwaway project has neither, so the test
// covers what works without an import (server start, document symbols) and that the server's
// "import skipped" message reaches the Notifications tool window.
test('kotlin-lsp starts, lists symbols and explains a skipped project import', async () => {
  const { page } = fixture
  await page.keyboard.press('Meta+Shift+KeyO')
  await expect(page.getByRole('dialog', { name: 'Files' })).toBeVisible()
  await page.keyboard.type('Greeter.kt')
  await expect(page.locator('.popup-item').first()).toContainText('Greeter.kt')
  await page.keyboard.press('Enter')

  await page.locator('.stripe-button[title^="Structure"]').click()
  await expect(page.getByRole('tree', { name: 'Structure' })).toContainText('Greeter', { timeout: 150_000 })
  await expect(page.getByRole('tree', { name: 'Structure' })).toContainText('greet')

  await page.locator('.stripe-button[title^="Notifications"]').click()
  await expect(page.getByRole('list', { name: 'Notifications' })).toContainText('no supported build system')
})
