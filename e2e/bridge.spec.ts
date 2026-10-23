import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launch, type Fixture } from './app'
import { FakeClaude } from './claudeClient'

let fixture: Fixture
let claude: FakeClaude

test.beforeEach(async () => {
  fixture = await launch()
  claude = await FakeClaude.connect(fixture.claudeConfigDir)
})

test.afterEach(async () => {
  claude.close()
  await fixture.close()
})

test('advertises AnyCode in the lock file and shows the connection', async () => {
  expect(claude.lock).toMatchObject({ ideName: 'AnyCode', transport: 'ws', workspaceFolders: [fixture.project] })
  await expect(fixture.page.locator('.status-bar')).toContainText('Claude connected')
  const folders = JSON.parse((await claude.call('getWorkspaceFolders'))[0]!) as { rootPath: string }
  expect(folders.rootPath).toBe(fixture.project)
})

test('terminals get the bridge port so `claude` connects by itself', async () => {
  const { page } = fixture
  await page.locator('.terminal-host').click()
  await page.keyboard.type('echo "port=$CLAUDE_CODE_SSE_PORT ide=$ENABLE_IDE_INTEGRATION"\n')
  await expect(page.locator('.terminal-host .xterm-rows')).toContainText(`port=${claude.port} ide=true`)
})

test('openFile selects text, and selection tools and notifications report it', async () => {
  const file = join(fixture.project, 'src', 'greeting.ts')
  expect(await claude.call('openFile', { filePath: file, startText: 'greeting', endText: 'string' })).toEqual([`Opened file: ${file}`])
  await expect(fixture.page.getByRole('tab', { name: /greeting\.ts/ })).toHaveAttribute('aria-selected', 'true')

  await expect
    .poll(async () => JSON.parse((await claude.call('getCurrentSelection'))[0]!) as { text?: string })
    .toMatchObject({ text: 'greeting = (name: string', filePath: file })
  await expect.poll(() => claude.notifications.some((n) => n.method === 'selection_changed')).toBe(true)

  const editors = JSON.parse((await claude.call('getOpenEditors'))[0]!) as { tabs: { label: string; isActive: boolean }[] }
  expect(editors.tabs).toEqual([expect.objectContaining({ label: 'greeting.ts', isActive: true, isDirty: false })])
  expect(JSON.parse((await claude.call('checkDocumentDirty', { filePath: file }))[0]!)).toMatchObject({ success: true, isDirty: false })
})

test('openDiff blocks until the user accepts, returning the final contents', async () => {
  const file = join(fixture.project, 'src', 'greeting.ts')
  const proposed = 'export const greeting = (name: string) => `Hi, ${name}!`\n'
  const pending = claude.call('openDiff', {
    old_file_path: file,
    new_file_path: file,
    new_file_contents: proposed,
    tab_name: 'greeting.ts (proposed)',
  })
  const { page } = fixture
  await expect(page.locator('.diff-toolbar')).toContainText('Claude proposes changes to src/greeting.ts')
  await page.getByRole('button', { name: 'Accept' }).click()
  expect(await pending).toEqual(['FILE_SAVED', proposed])
  await expect(page.locator('.diff-toolbar')).toHaveCount(0)
})

test('rejecting a diff answers DIFF_REJECTED and closeAllDiffTabs clears the rest', async () => {
  const file = join(fixture.project, 'README.md')
  const first = claude.call('openDiff', { old_file_path: file, new_file_path: file, new_file_contents: '# A\n', tab_name: 'a' })
  await expect(fixture.page.locator('.diff-toolbar')).toBeVisible()
  await fixture.page.getByRole('button', { name: 'Reject' }).click()
  expect(await first).toEqual(['DIFF_REJECTED'])

  const second = claude.call('openDiff', { old_file_path: file, new_file_path: file, new_file_contents: '# B\n', tab_name: 'b' })
  await expect(fixture.page.locator('.diff-toolbar')).toBeVisible()
  expect(await claude.call('closeAllDiffTabs')).toEqual(['CLOSED_1_DIFF_TABS'])
  expect(await second).toEqual(['DIFF_REJECTED'])
})

test('files written by the agent reload in the open editor', async () => {
  const file = join(fixture.project, 'src', 'greeting.ts')
  await claude.call('openFile', { filePath: file })
  await expect(fixture.page.locator('.monaco-editor .view-lines')).toContainText('Hello')
  await writeFile(file, 'export const greeting = "changed on disk"\n')
  await expect(fixture.page.locator('.monaco-editor .view-lines')).toContainText('changed on disk')
})
