import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { gotoFile, launch, type Fixture } from './app'

// A Maven project built offline from ~/.m2 (Maven comes from ~/.m2/wrapper/dists): Debug on a JUnit
// test runs Surefire with a JDWP agent and java-debug, inside jdtls, attaches to the test JVM.
const servers = join(homedir(), 'Library', 'Application Support', 'AnyCode', 'language-servers')
const m2 = join(homedir(), '.m2')
const ready =
  existsSync(join(servers, 'jdtls')) &&
  existsSync(join(servers, 'java-debug')) &&
  existsSync(join(m2, 'wrapper', 'dists')) &&
  existsSync(join(m2, 'repository', 'org', 'junit', 'jupiter', 'junit-jupiter', '5.12.2')) &&
  existsSync(join(m2, 'repository', 'org', 'apache', 'maven', 'plugins', 'maven-surefire-plugin', '3.5.4'))

test.skip(!ready, 'needs jdtls, java-debug, a Maven distribution and JUnit 5.12.2 / Surefire 3.5.4 in ~/.m2')

const POM = `<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.acme</groupId>
  <artifactId>calc</artifactId>
  <version>1.0</version>
  <properties>
    <maven.compiler.release>17</maven.compiler.release>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
  </properties>
  <dependencies>
    <dependency>
      <groupId>org.junit.jupiter</groupId>
      <artifactId>junit-jupiter</artifactId>
      <version>5.12.2</version>
      <scope>test</scope>
    </dependency>
  </dependencies>
  <build>
    <plugins>
      <plugin><artifactId>maven-resources-plugin</artifactId><version>3.3.1</version></plugin>
      <plugin><artifactId>maven-compiler-plugin</artifactId><version>3.14.1</version></plugin>
      <plugin><artifactId>maven-surefire-plugin</artifactId><version>3.5.4</version></plugin>
    </plugins>
  </build>
</project>
`

const TEST = `package com.acme;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class CalculatorTest {
    @Test
    void adds() {
        int a = 2;
        int b = 3;
        int sum = a + b;
        assertEquals(5, sum);
    }
}
`

let fixture: Fixture

test.beforeEach(async () => {
  fixture = await launch({
    setup: async (root) => {
      await writeFile(join(root, 'pom.xml'), POM)
      await mkdir(join(root, '.mvn'))
      await writeFile(join(root, '.mvn', 'maven.config'), '-o\n')
      await mkdir(join(root, 'src', 'test', 'java', 'com', 'acme'), { recursive: true })
      await writeFile(join(root, 'src', 'test', 'java', 'com', 'acme', 'CalculatorTest.java'), TEST)
    },
  })
})

test.afterEach(async () => {
  await fixture.close()
})

test('Debug on a JUnit test stops at its breakpoint with the test variables', async () => {
  test.setTimeout(240_000)
  const { page } = fixture
  await gotoFile(page, 'CalculatorTest.java')
  await page.locator('.editor-pane .monaco-editor .view-lines').click()
  await page.keyboard.press('Meta+KeyL')
  await page.keyboard.type('13')
  await page.keyboard.press('Enter')
  await expect(page.locator('.status-bar')).toContainText('13:1')
  await expect(page.locator('.quick-input-widget')).toBeHidden()
  await page.keyboard.press('Meta+F8')

  await page.locator('.codelens-decoration a', { hasText: /^Debug$/ }).nth(1).click({ timeout: 30_000 })
  const debug = page.locator('[data-tool-window="Debug"]')
  await expect(debug.locator('.debug-frame.selected')).toContainText('CalculatorTest.java:13', { timeout: 200_000 })
  const variables = debug.getByRole('tree', { name: 'Variables' })
  await expect(variables).toContainText('sum = 5')
  await expect(variables).toContainText('a = 2')

  await page.keyboard.press('F9') // Resume: the test passes and the JVM exits
  await expect(page.locator('.tool-window-tab', { hasText: 'CalculatorTest.adds' })).toHaveAttribute('data-status', 'terminated', { timeout: 60_000 })
  await debug.getByRole('tab', { name: 'Console' }).click()
  await expect(debug.locator('.terminal-session:visible .xterm-rows')).toContainText('Tests run: 1, Failures: 0', { timeout: 30_000 })
})
