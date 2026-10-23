import { execFileSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launch, type Fixture } from './app'

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
