import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/desktop-e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report/desktop', open: 'never' }],
  ],
  outputDir: 'test-results/desktop',
  use: {
    trace: 'off',
    screenshot: 'off',
  },
})
