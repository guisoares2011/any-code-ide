import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  // The packaged-app suite runs on its own (npm run test:packaged), against dist/.
  testIgnore: process.env.ANYCODE_TEST_PACKAGED ? [] : ['packaged/**'],
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
  outputDir: 'out/e2e-results',
})
