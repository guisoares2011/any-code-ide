import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { gotoFile, launch, type Fixture } from './app'

// A Gradle project whose wrapper only prints its arguments: the test shows what AnyCode runs
// without needing Gradle, a JDK or the network.
const TEST_SOURCE = `package com.acme;

import org.junit.jupiter.api.Test;

class GreetingTest {
    @Test
    void greets() {
    }

    @Test
    void waves() {
    }
}
`

let fixture: Fixture

test.beforeEach(async () => {
  fixture = await launch({
    setup: async (root) => {
      await writeFile(join(root, 'gradlew'), '#!/bin/sh\necho "fake-gradle $*"\n')
      await chmod(join(root, 'gradlew'), 0o755)
      await writeFile(join(root, 'settings.gradle'), "include 'app'\n")
      await mkdir(join(root, 'app', 'src', 'test', 'java', 'com', 'acme'), { recursive: true })
      await writeFile(join(root, 'app', 'src', 'test', 'java', 'com', 'acme', 'GreetingTest.java'), TEST_SOURCE)
    },
  })
})

test.afterEach(async () => {
  await fixture.close()
})

test('Run above a test method runs it through the build as a temporary configuration', async () => {
  const { page } = fixture
  await gotoFile(page, 'GreetingTest.java')
  const lens = page.locator('.codelens-decoration a', { hasText: "▶ Run 'waves()'" })
  await expect(lens).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.codelens-decoration a', { hasText: "▶ Run 'GreetingTest'" })).toBeVisible()
  await lens.click()
  const output = page.locator('[data-tool-window="Run"] .terminal-session:visible .xterm-rows')
  await expect(output).toContainText('fake-gradle :app:test --tests com.acme.GreetingTest.waves')
  // The temporary configuration is selected in the run widget, ready for Rerun.
  await expect(page.getByTitle('Select Run/Debug Configuration')).toContainText('GreetingTest.waves')
})

test('RunClass (⌃⇧R) runs the test at the caret, or the class', async () => {
  const { page } = fixture
  await gotoFile(page, 'GreetingTest.java')
  await expect(page.locator('.codelens-decoration a').first()).toBeVisible({ timeout: 15_000 })
  await page.locator('.editor-pane .monaco-editor .view-lines').click()
  await page.keyboard.press('Meta+KeyL') // GotoLine
  await page.keyboard.type('8')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Control+Shift+KeyR')
  const output = page.locator('[data-tool-window="Run"] .terminal-session:visible .xterm-rows')
  await expect(output).toContainText('fake-gradle :app:test --tests com.acme.GreetingTest.greets')

  // Above the methods (on the class), the whole class runs.
  await page.keyboard.press('Meta+KeyL')
  await page.keyboard.type('5')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Control+Shift+KeyR')
  await expect(page.locator('.tool-window-tab', { hasText: /^GreetingTest$/ })).toBeVisible()
  await expect(output).toContainText(/fake-gradle :app:test --tests com\.acme\.GreetingTest(?!\.)/)
})
