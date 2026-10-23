import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launch, type Fixture } from './app'

/** Maven reachable the way AnyCode looks for it: mvn on PATH or a wrapper download in ~/.m2. */
function mavenAvailable(): boolean {
  if (existsSync(join(homedir(), '.m2', 'wrapper', 'dists'))) return true
  try {
    execFileSync(process.env.SHELL ?? '/bin/zsh', ['-l', '-c', 'command -v mvn'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

test.skip(!mavenAvailable(), 'Maven is not available')
test.setTimeout(120_000)

let fixture: Fixture

async function writeMavenProject(root: string): Promise<void> {
  await writeFile(
    join(root, 'pom.xml'),
    `<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion>
<groupId>com.acme</groupId><artifactId>acme-parent</artifactId><version>1.0.0</version><packaging>pom</packaging>
<modules><module>core</module><module>app</module></modules>
<profiles><profile><id>local</id></profile></profiles></project>`,
  )
  for (const [module, deps] of [
    ['core', ''],
    [
      'app',
      `<dependencies><dependency><groupId>com.acme</groupId><artifactId>acme-core</artifactId><version>1.0.0</version></dependency>
<dependency><groupId>org.apache.commons</groupId><artifactId>commons-lang3</artifactId><version>3.8.1</version></dependency></dependencies>`,
    ],
  ] as const) {
    await mkdir(join(root, module), { recursive: true })
    await writeFile(
      join(root, module, 'pom.xml'),
      `<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion>
<parent><groupId>com.acme</groupId><artifactId>acme-parent</artifactId><version>1.0.0</version></parent>
<artifactId>acme-${module}</artifactId>${deps}</project>`,
    )
  }
  // A run configuration IntelliJ keeps privately, to be imported.
  await mkdir(join(root, '.idea'), { recursive: true })
  await writeFile(
    join(root, '.idea', 'workspace.xml'),
    `<project version="4"><component name="RunManager">
<configuration name="From IntelliJ" type="ShConfigurationType">
<option name="SCRIPT_TEXT" value="echo imported-from-intellij" /><option name="EXECUTE_SCRIPT_FILE" value="false" />
</configuration></component></project>`,
  )
}

test.beforeEach(async () => {
  fixture = await launch({
    setup: writeMavenProject,
  })
})

test.afterEach(async () => {
  await fixture.close()
})

test('the Maven tool window shows modules, lifecycle and resolved dependencies', async () => {
  const { page } = fixture
  await page.locator('.stripe-button[title^="Maven"]').click()
  const tree = page.getByRole('tree', { name: 'Maven' })
  await expect(tree).toContainText('acme-parent')
  await expect(tree).toContainText('Lifecycle')
  await expect(tree).toContainText('Profiles')

  await tree.getByRole('treeitem').filter({ hasText: 'acme-app' }).locator('.tree-chevron').click()
  await tree.getByRole('treeitem').filter({ hasText: 'Dependencies' }).locator('.tree-chevron').click()
  await expect(tree).toContainText('org.apache.commons:commons-lang3:3.8.1', { timeout: 90_000 })
  await expect(tree).toContainText('com.acme:acme-core:1.0.0')
})

test('double-clicking a lifecycle phase runs it in the Run tool window', async () => {
  const { page } = fixture
  await page.locator('.stripe-button[title^="Maven"]').click()
  const tree = page.getByRole('tree', { name: 'Maven' })
  await tree.getByRole('treeitem').filter({ hasText: /^Lifecycle$/ }).first().locator('.tree-chevron').click()
  await tree.getByRole('treeitem').filter({ hasText: /^validate$/ }).first().dblclick()
  await expect(page.locator('.tool-window-tab', { hasText: 'acme-parent [validate]' })).toBeVisible()
  await expect(page.locator('[data-tool-window="Run"] .xterm-rows')).toContainText('BUILD SUCCESS', { timeout: 90_000 })
})

test('Edit Configurations creates a shared IntelliJ-format configuration and runs it', async () => {
  const { page, project } = fixture
  await page.locator('.main-toolbar').getByTitle('Select Run/Debug Configuration').click()
  const popup = page.getByRole('dialog', { name: 'Run' })
  await expect(popup).toContainText('From IntelliJ')
  await expect(popup).toContainText('IntelliJ')
  await page.keyboard.type('Edit')
  await page.keyboard.press('Enter')

  const dialog = page.getByRole('dialog', { name: 'Run/Debug Configurations' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Add New Configuration' }).click()
  await dialog.getByRole('menuitem', { name: 'Shell Script' }).click()
  await dialog.getByLabel('Name').fill('Hello')
  await dialog.getByLabel('Script text').fill('echo "hello-from-$GREETING"')
  await dialog.getByLabel('Environment variables').fill('GREETING=config')
  await dialog.getByLabel(/Store as project file/).check()
  await dialog.getByRole('button', { name: 'Run' }).click()

  await expect(dialog).toBeHidden()
  await expect(page.locator('[data-tool-window="Run"] .xterm-rows')).toContainText('hello-from-config')
  const file = await readFile(join(project, '.run', 'Hello.run.xml'), 'utf8')
  expect(file).toContain('type="ShConfigurationType"')
  expect(file).toContain('name="GREETING"')
  await expect(page.locator('.main-toolbar')).toContainText('Hello')
})
