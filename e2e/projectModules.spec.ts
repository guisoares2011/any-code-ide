import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launch, type Fixture } from './app'

let fixture: Fixture

test.afterEach(async () => {
  await fixture.close()
})

const pom = (body: string): string => `<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion>${body}</project>`

test('the Project view shows Maven modules and source roots like IntelliJ', async () => {
  fixture = await launch()
  const { page, project } = fixture
  const tree = page.getByRole('tree', { name: 'Project' })
  await expect(tree).toContainText('src')

  // Written after start: the view rereads the reactor when a pom.xml changes.
  await mkdir(join(project, 'core', 'src', 'main', 'java'), { recursive: true })
  await mkdir(join(project, 'core', 'src', 'test', 'java'), { recursive: true })
  await mkdir(join(project, 'web'), { recursive: true })
  await writeFile(join(project, 'core', 'pom.xml'), pom('<parent><groupId>com.acme</groupId><artifactId>parent</artifactId><version>1</version></parent><artifactId>core</artifactId>'))
  await writeFile(join(project, 'web', 'pom.xml'), pom('<parent><groupId>com.acme</groupId><artifactId>parent</artifactId><version>1</version></parent><artifactId>acme-web</artifactId>'))
  await writeFile(
    join(project, 'pom.xml'),
    pom('<groupId>com.acme</groupId><artifactId>parent</artifactId><version>1</version><packaging>pom</packaging><modules><module>core</module><module>web</module></modules>'),
  )

  const web = tree.locator(`[data-path="${join(project, 'web')}"]`)
  await expect(web).toContainText('web[acme-web]')
  await expect(web).toHaveAttribute('data-icon', 'nodes/module')
  const core = tree.locator(`[data-path="${join(project, 'core')}"]`)
  await expect(core.locator('.module-root')).toHaveText('core')
  await core.click()
  await tree.locator(`[data-path="${join(project, 'core', 'src')}"]`).click()
  await tree.locator(`[data-path="${join(project, 'core', 'src', 'main')}"]`).click()
  await expect(tree.locator(`[data-path="${join(project, 'core', 'src', 'main', 'java')}"]`)).toHaveAttribute('data-icon', 'nodes/sourceRoot')
})
