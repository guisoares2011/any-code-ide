import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { gotoFile, launch, type Fixture } from './app'

const SCRIPT = `const items = [1, 2, 3]
let total = 0
for (const item of items) {
  total += item
}
console.log('total is', total)
`

const jsDebugInstalled = existsSync(join(homedir(), 'Library', 'Application Support', 'AnyCode', 'language-servers', 'js-debug'))

let fixture: Fixture

test.beforeEach(async () => {
  fixture = await launch({
    setup: async (root) => {
      await writeFile(join(root, 'app.js'), SCRIPT)
      const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
      pkg.scripts = { calc: 'node app.js', ...pkg.scripts }
      await writeFile(join(root, 'package.json'), JSON.stringify(pkg, null, 2))
    },
  })
})

test.afterEach(async () => {
  await fixture.close()
})

const debugWindow = (page: Page) => page.locator('[data-tool-window="Debug"]')

async function breakAt(page: Page, line: number): Promise<void> {
  await page.locator('.editor-pane .monaco-editor .view-lines').click()
  await page.keyboard.press('Meta+KeyL') // GotoLine
  await page.keyboard.type(String(line))
  await page.keyboard.press('Enter')
  await expect(page.locator('.status-bar')).toContainText(`${line}:1`)
  await expect(page.locator('.quick-input-widget')).toBeHidden()
  await page.keyboard.press('Meta+F8') // ToggleLineBreakpoint
}

test('⌘F8 and gutter clicks toggle breakpoints that survive edits above them', async () => {
  const { page } = fixture
  await gotoFile(page, 'app.js')
  await breakAt(page, 4)
  await expect(page.locator('.debug-breakpoint-glyph')).toHaveCount(1)
  // A line inserted above moves the breakpoint down with its code.
  await page.keyboard.press('Meta+ArrowUp') // start of the file
  await expect(page.locator('.status-bar')).toContainText('1:1')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Meta+Shift+F8') // ViewBreakpoints
  await expect(page.getByRole('dialog', { name: 'Breakpoints' })).toContainText('app.js:5')
  await page.keyboard.press('Escape')
  // Clicking the gutter mark removes it.
  await page.locator('.debug-breakpoint-glyph').click()
  await expect(page.locator('.debug-breakpoint-glyph')).toHaveCount(0)
})

test('Debug from the context menu stops at a breakpoint, shows variables, steps and evaluates', async () => {
  test.skip(!jsDebugInstalled, 'js-debug is not installed (node scripts/install-language-servers.mjs js-debug)')
  test.setTimeout(90_000)
  const { page } = fixture
  await gotoFile(page, 'app.js')
  await breakAt(page, 4)

  await page.getByRole('treeitem').filter({ has: page.locator('span:text-is("app.js")') }).click({ button: 'right' })
  await page.getByRole('menuitem').filter({ hasText: /^Debug 'app\.js'/ }).click()

  const debug = debugWindow(page)
  await expect(debug.locator('.debug-frame.selected')).toContainText('app.js:4', { timeout: 30_000 })
  await expect(page.locator('.debug-execution-line')).toHaveCount(1)
  const variables = debug.getByRole('tree', { name: 'Variables' })
  await expect(variables).toContainText('item = 1')
  await expect(variables).toContainText('total = 0')

  // Step Over (F8) runs the line: total is 1 on the next line.
  await page.keyboard.press('F8')
  await expect(variables).toContainText('total = 1', { timeout: 10_000 })

  // Resume (F9) stops at the breakpoint again with the next item.
  await page.keyboard.press('F9')
  await expect(variables).toContainText('item = 2', { timeout: 10_000 })

  // Evaluate Expression (⌥F8) in the frame.
  await page.keyboard.press('Alt+F8')
  await expect(debug.getByRole('textbox', { name: 'Evaluate expression' })).toBeFocused()
  await page.keyboard.type('total * 10')
  await page.keyboard.press('Enter')
  await expect(variables).toContainText('total * 10 = 10')

  // Without the breakpoint the program runs to the end; its output is in the Console tab.
  await gotoFile(page, 'app.js')
  await breakAt(page, 4)
  await page.keyboard.press('F9')
  await debug.getByRole('tab', { name: 'Console' }).click()
  await expect(debug.locator('.terminal-session:visible .xterm-rows')).toContainText('total is 6', { timeout: 15_000 })
  await expect(page.locator('.tool-window-tab', { hasText: 'app.js' })).toHaveAttribute('data-status', 'terminated', { timeout: 15_000 })
})

test('Debug (⌃D) runs an npm configuration under the debugger', async () => {
  test.skip(!jsDebugInstalled, 'js-debug is not installed (node scripts/install-language-servers.mjs js-debug)')
  test.setTimeout(90_000)
  const { page } = fixture
  await gotoFile(page, 'app.js')
  await breakAt(page, 6)
  await expect(page.getByTitle('Select Run/Debug Configuration')).toContainText('calc')
  await page.keyboard.press('Control+KeyD')
  const debug = debugWindow(page)
  await expect(debug.locator('.debug-frame.selected')).toContainText('app.js:6', { timeout: 30_000 })
  await expect(debug.getByRole('tree', { name: 'Variables' })).toContainText('total = 6')
  // Stop (⌘F2) ends the program.
  await page.keyboard.press('Meta+F2')
  await expect(page.locator('.tool-window-tab', { hasText: 'calc' })).toHaveAttribute('data-status', 'terminated', { timeout: 15_000 })
})
