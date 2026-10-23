import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { createProject } from '../app'

// Smoke test of the built bundle (npm run test:packaged, after npm run package:dir): the parts that
// break only when packaged, such as native modules outside app.asar, the bundled typescript-go and
// the ESLint worker forked from inside app.asar.

test('the packaged app runs terminals, typescript-go, ESLint and git', async () => {
  const project = await createProject()
  await writeFile(join(project, 'src', 'broken.ts'), 'export const n: number = "text"\n')
  await symlink(join(process.cwd(), 'node_modules'), join(project, 'node_modules'))
  await writeFile(join(project, 'eslint.config.mjs'), "export default [{ files: ['**/*.js'], rules: { 'no-var': 'error' } }]\n")
  await writeFile(join(project, 'src', 'app.js'), 'var a = 1\nconsole.log(a)\n')
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: project })
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'add', 'src', 'package.json'], { cwd: project })
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'packaged initial'], { cwd: project })
  const userData = await mkdtemp(join(tmpdir(), 'anycode-userdata-'))
  const app = await electron.launch({
    executablePath: resolve('dist/mac-arm64/AnyCode.app/Contents/MacOS/AnyCode'),
    args: [`--project=${project}`],
    env: { ...process.env, ANYCODE_HEADLESS: '1', ANYCODE_AGENT_COMMAND: '', ANYCODE_USER_DATA: userData, CLAUDE_CONFIG_DIR: userData },
  })
  const logs: string[] = []
  app.process().stdout?.on('data', (d: Buffer) => logs.push(d.toString()))
  app.process().stderr?.on('data', (d: Buffer) => logs.push(d.toString()))
  const page = await app.firstWindow()
  await page.waitForSelector('.workbench')
  expect(await app.evaluate(({ app: a }) => a.isPackaged)).toBe(true)

  // node-pty from app.asar.unpacked
  await expect(page.locator('.terminal-host .xterm-rows')).toContainText(project.split('/').pop()!, { timeout: 15_000 })

  // typescript-go from app.asar.unpacked
  await page.keyboard.press('Meta+Shift+KeyO')
  await page.keyboard.type('broken.ts')
  await expect(page.getByRole('dialog', { name: 'Files' })).toContainText('1 results')
  await page.keyboard.press('Enter')
  await page.locator('.stripe-button[title^="Problems"]').click()
  const problems = page.getByRole('tree', { name: 'Problems' })
  await expect(problems).toContainText("is not assignable to type 'number'", { timeout: 30_000 }).catch((e) => {
    console.log('main process log:\n' + logs.join('').split('\n').filter((l) => /lsp|error|Error/i.test(l)).slice(0, 30).join('\n'))
    throw e
  })

  // ESLint worker forked from inside app.asar
  await page.keyboard.press('Meta+Shift+KeyO')
  await page.keyboard.type('app.js')
  await expect(page.getByRole('dialog', { name: 'Files' })).toContainText('1 results')
  await page.keyboard.press('Enter')
  await expect(problems).toContainText('(no-var)', { timeout: 30_000 })

  // git log
  await page.keyboard.press('Meta+Digit9')
  await expect(page.getByRole('tree', { name: 'Commits' })).toContainText('packaged initial')
  await page.screenshot({ path: 'out/screenshots/packaged.png' })

  await app.close()
  await rm(project, { recursive: true, force: true })
  await rm(userData, { recursive: true, force: true })
})
