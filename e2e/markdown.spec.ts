import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launch, type Fixture } from './app'

// 1x1 transparent PNG
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

const README = `# Sample project

![logo](docs/logo.png)

See the [guide](docs/guide.md) and [usage](#usage).

## Usage

\`\`\`bash
$ echo readme-run-ok # prints a marker
\`\`\`

\`\`\`ts
const answer: number = 42
\`\`\`
`

let fixture: Fixture

test.beforeEach(async () => {
  fixture = await launch({
    setup: async (root) => {
      await mkdir(join(root, 'docs'), { recursive: true })
      await writeFile(join(root, 'README.md'), README)
      await writeFile(join(root, 'docs', 'guide.md'), '# Guide\n')
      await writeFile(join(root, 'docs', 'logo.png'), PIXEL)
    },
  })
  const { page } = fixture
  await page.keyboard.press('Meta+Shift+KeyO')
  await expect(page.getByRole('dialog', { name: 'Files' })).toBeVisible()
  await page.keyboard.type('README.md')
  await expect(page.locator('.popup-item').first()).toContainText('README.md')
  await page.keyboard.press('Enter')
})

test.afterEach(async () => {
  await fixture.close()
})

test('a README opens rendered, with highlighted code, local images and anchors', async () => {
  const { page } = fixture
  const preview = page.locator('.markdown-body')
  await expect(preview.locator('h1')).toHaveText('Sample project')
  await expect(page.locator('.editor-pane')).toBeHidden()
  await expect(preview.locator('img')).toHaveAttribute('src', /^data:image\/png;base64,/)
  // Code blocks use the editor's syntax colors (Monaco colorize).
  await expect(preview.locator('code[data-lang="ts"] span').first()).toBeVisible()
  await expect(preview.locator('h2#usage')).toHaveText('Usage')
})

test('▶ Run in the preview runs the shell block in a new terminal tab', async () => {
  const { page } = fixture
  await page.locator('.md-run').click()
  await expect(page.locator('.tool-window-tab', { hasText: 'echo readme-run-ok' })).toBeVisible()
  await expect(page.locator('.terminal-host .terminal-session:visible .xterm-rows')).toContainText('readme-run-ok')
})

test('the layout switches and the editor offers Run in Terminal above shell blocks', async () => {
  const { page } = fixture
  await page.getByRole('button', { name: 'Editor and Preview' }).click()
  await expect(page.locator('.editor-pane')).toBeVisible()
  await expect(page.locator('.preview-pane')).toBeVisible()
  await page.getByRole('button', { name: 'Editor Only' }).click()
  await expect(page.locator('.preview-pane')).toHaveCount(0)
  const lens = page.locator('.codelens-decoration a', { hasText: 'Run in Terminal' })
  await expect(lens).toBeVisible()
  await lens.click()
  await expect(page.locator('.terminal-host .terminal-session:visible .xterm-rows')).toContainText('readme-run-ok')
})

test('relative links open the target file', async () => {
  const { page } = fixture
  await page.locator('.markdown-body a', { hasText: 'guide' }).click()
  await expect(page.getByRole('tab', { name: /guide\.md/ })).toHaveAttribute('aria-selected', 'true')
})
