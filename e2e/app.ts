import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

export interface Fixture {
  app: ElectronApplication
  page: Page
  project: string
  /** CLAUDE_CONFIG_DIR of the app under test; the bridge writes its lock file in <dir>/ide. */
  claudeConfigDir: string
  close(): Promise<void>
}

/** A throwaway project with a few files, so tests never touch the user's repositories. */
export async function createProject(): Promise<string> {
  // realpath: /var/folders is a symlink to /private/var/folders and language servers (jdtls) resolve it.
  const root = await realpath(await mkdtemp(join(tmpdir(), 'anycode-e2e-')))
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'src', 'greeting.ts'), 'export const greeting = (name: string) => `Hello, ${name}`\n')
  await writeFile(
    join(root, 'src', 'main.ts'),
    "import { greeting } from './greeting'\n\nexport const count: number = greeting('AnyCode')\n",
  )
  await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, module: 'esnext', target: 'es2022' } }))
  await writeFile(join(root, 'README.md'), '# Sample\n')
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ name: 'sample', scripts: { hello: 'node -e "console.log(\'hello from run\')"' } }, null, 2),
  )
  return root
}

export interface LaunchOptions {
  /** Make the project a git repository with everything committed. */
  git?: boolean
}

function gitInit(root: string): void {
  const sh = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' })
  sh('init', '-q', '-b', 'main')
  sh('config', 'user.email', 'e2e@example.com')
  sh('config', 'user.name', 'AnyCode E2E')
  sh('config', 'commit.gpgsign', 'false')
  sh('add', '.')
  sh('commit', '-q', '-m', 'initial')
}

/** Launches the built app hidden (ANYCODE_HEADLESS=1) on a temporary project. */
export async function launch(options: LaunchOptions = {}): Promise<Fixture> {
  const project = await createProject()
  if (options.git) gitInit(project)
  const claudeConfigDir = await mkdtemp(join(tmpdir(), 'anycode-claude-'))
  const userData = await mkdtemp(join(tmpdir(), 'anycode-userdata-'))
  const app = await electron.launch({
    args: [resolve('out/main/index.js'), `--project=${project}`],
    env: { ...process.env, ANYCODE_HEADLESS: '1', ANYCODE_AGENT_COMMAND: '', CLAUDE_CONFIG_DIR: claudeConfigDir, ANYCODE_USER_DATA: userData, ANYCODE_LSP_TRACE: process.env.ANYCODE_LSP_TRACE ?? '' },
  })
  const page = await app.firstWindow()
  await page.waitForSelector('.workbench')
  return {
    app,
    page,
    project,
    claudeConfigDir,
    async close() {
      await app.close()
      await rm(project, { recursive: true, force: true })
      await rm(claudeConfigDir, { recursive: true, force: true })
      await rm(userData, { recursive: true, force: true })
    },
  }
}
