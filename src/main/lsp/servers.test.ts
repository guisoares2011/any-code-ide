import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { compareVersions, findKotlinLauncher, installedServer, serverCommand } from './servers'

describe('language server resolution', () => {
  let appDir: string

  beforeEach(async () => {
    appDir = await mkdtemp(join(tmpdir(), 'anycode-ls-'))
  })

  afterEach(async () => {
    await rm(appDir, { recursive: true, force: true })
  })

  async function install(name: string, version: string, files: string[] = []): Promise<string> {
    const dir = join(appDir, 'language-servers', name, version)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, '.installed'), '{}')
    for (const file of files) {
      await mkdir(join(dir, file, '..'), { recursive: true })
      await writeFile(join(dir, file), '')
    }
    return dir
  }

  it('orders versions numerically', () => {
    expect(compareVersions('1.63.0', '1.100.0')).toBeLessThan(0)
    expect(compareVersions('263.7084.0', '263.7084.0')).toBe(0)
  })

  it('picks the newest complete install', async () => {
    await install('jdtls', '1.62.0')
    const newest = await install('jdtls', '1.63.0')
    await mkdir(join(appDir, 'language-servers', 'jdtls', '1.64.0'), { recursive: true }) // partial: no .installed
    expect(installedServer(appDir, 'jdtls')).toBe(newest)
    expect(installedServer(appDir, 'kotlin')).toBeNull()
  })

  it('builds the jdtls command with a per-project data directory', async () => {
    const home = await install('jdtls', '1.63.0', ['plugins/org.eclipse.equinox.launcher_1.8.0.jar'])
    const command = serverCommand('java', { root: '/p/app', appDir, env: { JAVA_HOME: '/nonexistent' } })
    expect(command.args).toContain(join(home, 'plugins', 'org.eclipse.equinox.launcher_1.8.0.jar'))
    expect(command.args[command.args.indexOf('-data') + 1]).toMatch(new RegExp(`^${appDir}/jdtls-workspaces/[0-9a-f]{40}$`))
  })

  it('explains how to install a missing server', () => {
    expect(() => serverCommand('kotlin', { root: '/p', appDir, env: {} })).toThrow(/install-language-servers/)
  })

  it('finds the kotlin server launcher inside the archive layout', async () => {
    // Same layout as the 263.7084.0 archive: a versioned directory with dots in its name.
    const home = await install('kotlin', '263.7084.0', [
      'kotlin-server-263.7084.0/kotlin-lsp.sh',
      'kotlin-server-263.7084.0/bin/intellij-server',
    ])
    expect(findKotlinLauncher(home)).toBe(join(home, 'kotlin-server-263.7084.0', 'bin', 'intellij-server'))
    const command = serverCommand('kotlin', { root: '/p/app', appDir, env: {} })
    expect(command.args).toEqual(['--stdio', expect.stringMatching(/--system-path=.*kotlin-system\/[0-9a-f]{40}$/), '--data-sharing=none'])
  })
})
