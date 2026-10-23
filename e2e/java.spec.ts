import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launch, type Fixture } from './app'

const jdtlsInstalled = existsSync(join(homedir(), 'Library', 'Application Support', 'AnyCode', 'language-servers', 'jdtls'))
test.skip(!jdtlsInstalled, 'jdtls not installed (node scripts/install-language-servers.mjs jdtls)')
// jdtls needs a while to import the project the first time.
test.setTimeout(120_000)

let fixture: Fixture

test.beforeEach(async () => {
  fixture = await launch()
  const dir = join(fixture.project, 'src', 'main', 'java', 'demo')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'Greeter.java'), 'package demo;\n\npublic class Greeter {\n  public String greet(String name) {\n    return "Hello, " + name;\n  }\n}\n')
  await writeFile(
    join(dir, 'Main.java'),
    'package demo;\n\npublic class Main {\n  public static void main(String[] args) {\n    int count = new Greeter().greet("AnyCode");\n  }\n}\n',
  )
})

test.afterEach(async () => {
  await fixture.close()
})

test('jdtls reports Java type errors and navigates to declarations', async () => {
  const { page } = fixture
  await page.keyboard.press('Meta+Shift+KeyO')
  await expect(page.getByRole('dialog', { name: 'Files' })).toBeVisible()
  await page.keyboard.type('Main.java')
  await expect(page.locator('.popup-item').first()).toContainText('Main.java')
  await page.keyboard.press('Enter')
  await page.locator('.stripe-button[title^="Problems"]').click()
  await expect(page.getByRole('tree', { name: 'Problems' })).toContainText('Type mismatch', { timeout: 90_000 })

  // Line 5 is `    int count = new Greeter().greet("AnyCode");`; column 22 is inside `Greeter`.
  await page.locator('.monaco-editor .view-lines').click()
  await page.keyboard.press('Meta+KeyL')
  await page.keyboard.type('5:22')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Meta+KeyB')
  await expect(page.getByRole('tab', { name: /Greeter\.java/ })).toHaveAttribute('aria-selected', 'true', { timeout: 20_000 })
})
