import { execFileSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { gotoFile, launch, type Fixture } from './app'

let fixture: Fixture
const git = (...args: string[]) => execFileSync('git', args, { cwd: fixture.project, encoding: 'utf8' }).trim()

test.beforeEach(async () => {
  fixture = await launch({ git: true })
  await writeFile(join(fixture.project, 'src', 'greeting.ts'), 'export const greeting = (name: string) => `Hi, ${name}!`\n')
  await writeFile(join(fixture.project, 'notes.txt'), 'scratch\n')
})

test.afterEach(async () => {
  await fixture.close()
})

test('the Commit tool window lists changes and commits the included ones with ⌘⏎', async () => {
  const { page } = fixture
  // Project tree colors follow the status (Project and Commit share the left anchor, so check first).
  await expect(page.getByRole('tree', { name: 'Project' }).locator('.vcs-untracked', { hasText: 'notes.txt' })).toBeVisible()
  await page.keyboard.press('Meta+Digit0') // ActivateCommitToolWindow
  const changes = page.getByRole('tree', { name: 'Changes' })
  await expect(changes).toContainText('greeting.ts')
  await expect(changes).toContainText('Unversioned Files')
  await expect(page.getByRole('checkbox', { name: 'Include src/greeting.ts' })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: 'Include notes.txt' })).not.toBeChecked()

  await changes.focus()
  await expect(page.getByRole('textbox', { name: 'Commit Message' })).not.toBeFocused()
  await page.keyboard.press('Meta+KeyK') // CheckinProject focuses the message
  await expect(page.getByRole('textbox', { name: 'Commit Message' })).toBeFocused()
  await page.keyboard.type('Make the greeting friendlier')
  await page.keyboard.press('Meta+Enter') // Commit.Execute

  await expect.poll(() => git('log', '-1', '--format=%s')).toBe('Make the greeting friendlier')
  expect(git('show', '--name-only', '--format=', 'HEAD')).toBe('src/greeting.ts')
  expect(git('status', '--porcelain')).toBe('?? notes.txt')
  await expect(changes).not.toContainText('greeting.ts')
  await expect(page.getByRole('textbox', { name: 'Commit Message' })).toHaveValue('')
})

test('double-clicking a change opens the HEAD ↔ Local diff', async () => {
  const { page } = fixture
  await page.keyboard.press('Meta+Digit0')
  await page.getByRole('tree', { name: 'Changes' }).getByText('greeting.ts').dblclick()
  await expect(page.getByRole('tab', { name: /greeting\.ts \(HEAD ↔ Local\)/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.diff-editor .editor.original')).toContainText('Hello')
  await expect(page.locator('.diff-editor .editor.modified')).toContainText('Hi,')
})

test('commits made outside AnyCode (by the agent) refresh the panel', async () => {
  const { page } = fixture
  await page.keyboard.press('Meta+Digit0')
  const changes = page.getByRole('tree', { name: 'Changes' })
  await expect(changes).toContainText('greeting.ts')
  git('commit', '-q', '-am', 'from the terminal')
  await expect(changes).not.toContainText('greeting.ts')
})

test('Commit and Push sets the upstream on the first push', async () => {
  const { page, project } = fixture
  const remote = `${project}-remote.git`
  execFileSync('git', ['init', '-q', '--bare', remote])
  git('remote', 'add', 'origin', remote)
  await page.keyboard.press('Meta+Digit0')
  await page.getByRole('textbox', { name: 'Commit Message' }).fill('Pushed from AnyCode')
  await page.getByRole('button', { name: 'Commit and Push…' }).click()
  const remoteHead = (): string => {
    try {
      return execFileSync('git', ['log', '-1', '--format=%s', 'main'], { cwd: remote, encoding: 'utf8', stdio: 'pipe' }).trim()
    } catch {
      return '' // branch not pushed yet
    }
  }
  await expect.poll(remoteHead, { timeout: 15_000 }).toBe('Pushed from AnyCode')
  expect(git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}')).toBe('origin/main')
  execFileSync('rm', ['-rf', remote])
})

test('Rollback (⌥⌘Z) reverts the selected change and the open editor', async () => {
  const { page } = fixture
  await gotoFile(page, 'greeting.ts')
  const editor = page.locator('.editor-pane .monaco-editor .view-lines')
  await expect(editor).toContainText('Hi,')
  // Unsaved edits in the editor are discarded too, like IntelliJ.
  await page.keyboard.press('Meta+ArrowDown')
  await page.keyboard.type('// draft')

  await page.keyboard.press('Meta+Digit0')
  const changes = page.getByRole('tree', { name: 'Changes' })
  await changes.getByText('greeting.ts').click()
  await page.keyboard.press('Meta+Alt+KeyZ') // ChangesView.Revert
  const dialog = page.getByRole('dialog', { name: 'Rollback Changes' })
  await expect(dialog.getByRole('checkbox', { name: 'Roll back src/greeting.ts' })).toBeChecked()
  await page.keyboard.press('Enter')

  await expect(dialog).toBeHidden()
  await expect.poll(() => git('status', '--porcelain')).toBe('?? notes.txt')
  await expect(changes).not.toContainText('greeting.ts')
  await expect(page.getByRole('tab', { name: /^greeting\.ts/ })).toBeVisible()
  await page.getByRole('tab', { name: /^greeting\.ts/ }).click()
  await expect(editor).toContainText('Hello')
  await expect(editor).not.toContainText('draft')
})

test('the Git log lists commits, filters them and opens a commit change', async () => {
  const { page } = fixture
  git('commit', '-q', '-am', 'Friendlier greeting')
  git('tag', 'v1')
  await page.keyboard.press('Meta+Digit9') // ActivateVersionControlToolWindow
  const commits = page.getByRole('tree', { name: 'Commits' })
  await expect(commits.getByRole('treeitem')).toHaveCount(2)
  await expect(commits.getByRole('treeitem').first()).toContainText('Friendlier greeting')
  await expect(commits.getByRole('treeitem').first()).toContainText('main')
  await expect(commits.getByRole('treeitem').first()).toContainText('v1')

  // The newest commit is selected; its files and message show on the right.
  const files = page.getByRole('tree', { name: 'Changed files' })
  await expect(files).toContainText('greeting.ts')
  await expect(page.getByLabel('Commit details')).toContainText('Friendlier greeting')

  await commits.focus()
  await page.keyboard.press('Meta+KeyL') // Vcs.Log.FocusTextFilter
  const filter = page.getByRole('textbox', { name: 'Filter commits by text or hash' })
  await expect(filter).toBeFocused()
  await page.keyboard.type('friendlier')
  await expect(commits.getByRole('treeitem')).toHaveCount(1)
  await filter.fill('')
  await expect(commits.getByRole('treeitem')).toHaveCount(2)

  await files.getByText('greeting.ts').dblclick()
  const hash = git('rev-parse', 'HEAD').slice(0, 8)
  await expect(page.getByRole('tab', { name: `greeting.ts (${hash})` })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.diff-editor .editor.original')).toContainText('Hello')
  await expect(page.locator('.diff-editor .editor.modified')).toContainText('Hi,')
})

test('Show History filters the log by the current file', async () => {
  const { page } = fixture
  git('add', 'notes.txt')
  git('commit', '-q', '-m', 'Add notes')
  await gotoFile(page, 'greeting.ts')
  await page.keyboard.press('Meta+Shift+KeyA')
  await page.keyboard.type('Show History')
  await page.keyboard.press('Enter')
  const commits = page.getByRole('tree', { name: 'Commits' })
  await expect(commits.getByRole('treeitem')).toHaveCount(1)
  await expect(page.getByText('Path: src/greeting.ts')).toBeVisible()
  await page.getByRole('button', { name: 'Clear path filter' }).click()
  await expect(commits.getByRole('treeitem')).toHaveCount(2)
})

test('the branch widget lists branches, checks one out and creates a new one', async () => {
  const { page } = fixture
  git('branch', 'feature/login')
  const toolbar = page.locator('.main-toolbar')
  await toolbar.getByRole('button', { name: 'main' }).click()
  const popup = page.getByRole('dialog', { name: 'Git Branches' })
  await expect(popup).toContainText('Local')
  await expect(popup.locator('.popup-item', { hasText: 'main' })).toContainText('current')
  await page.keyboard.type('login')
  await expect(popup.locator('.popup-item')).toHaveCount(2) // the branch and "Create new branch 'login'"
  await popup.locator('.popup-item', { hasText: 'feature/login' }).click()
  await expect.poll(() => git('branch', '--show-current')).toBe('feature/login')
  await expect(toolbar).toContainText('feature/login')

  await toolbar.getByRole('button', { name: 'feature/login' }).click()
  await page.keyboard.type('topic/new')
  await page.keyboard.press('Enter')
  await expect.poll(() => git('branch', '--show-current')).toBe('topic/new')
  await expect(toolbar).toContainText('topic/new')
})
