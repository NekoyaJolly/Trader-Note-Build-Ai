import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright 設定ファイル
 * 目的: TradeAssist アプリケーションのE2Eテスト実行環境を整える
 * 注意: AIエージェント実行時は直列化（workers: 1）
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  fullyParallel: false, // AIエージェント実行時は直列化
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // AI制御時は1つずつ実行
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'test-results.json' }],
    ['junit', { outputFile: 'test-results.xml' }]
  ],
  use: {
    baseURL: 'http://localhost:3102',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3102',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
