import { defineConfig, devices } from '@playwright/test';

const productionUiUrl = process.env.PRODUCTION_UI_URL ?? 'https://trader-note-build-ai.vercel.app';

/**
 * 本番公開面 smoke 用の Playwright 設定。
 * 認証済み smoke は scripts/check/production-*.ts で手動ログイン済み storageState を使う。
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  fullyParallel: false,
  forbidOnly: true,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report-production' }],
    ['junit', { outputFile: 'test-results-production.xml' }],
  ],
  use: {
    baseURL: productionUiUrl,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10000,
  },
  projects: [
    {
      name: 'production-chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
