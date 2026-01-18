import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright設定ファイル
 * E2Eテストの実行環境とブラウザ設定を定義
 */
export default defineConfig({
  testDir: './tests/e2e',
  
  // テスト実行設定
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  
  // レポート設定
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'test-results.json' }],
    ['junit', { outputFile: 'test-results.xml' }],
    ['list'],
  ],
  
  // テスト設定
  use: {
    // ベースURL
    baseURL: 'http://localhost:3102',
    
    // スクリーンショット設定
    screenshot: 'only-on-failure',
    
    // ビデオ設定
    video: 'retain-on-failure',
    
    // トレース設定
    trace: 'on-first-retry',
    
    // タイムアウト
    actionTimeout: 10000,
    navigationTimeout: 30000,
  },

  // テストタイムアウト
  timeout: 60000,
  expect: {
    timeout: 5000,
  },

  // プロジェクト設定（ブラウザ）
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Webサーバー設定（テスト実行時に自動起動）
  webServer: process.env.CI ? undefined : {
    command: 'npm run dev',
    url: 'http://localhost:3102',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
