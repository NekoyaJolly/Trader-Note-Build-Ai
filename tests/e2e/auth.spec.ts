import { test, expect } from '@playwright/test';

// 認証フローのE2Eテスト
test.describe('認証フロー', () => {
  test.beforeEach(async ({ page }) => {
    // ログインページにアクセス
    await page.goto('http://localhost:3102/login');
  });

  test('ログインページが表示される', async ({ page }) => {
    // ページタイトル確認
    await expect(page).toHaveTitle(/TradeAssist/i);
    
    // ログインページの基本要素確認 - strict mode違反を修正
    // 修正案1: getByRoleを使用（推奨）
    await expect(page.getByRole('heading', { name: /ログイン|TradeAssist/i })).toBeVisible();
  });

  test('未認証でダッシュボードにアクセスするとログインにリダイレクト', async ({ page }) => {
    // ダッシュボードに直接アクセス
    await page.goto('http://localhost:3102/dashboard');
    
    // ログインページにリダイレクトされることを確認
    await page.waitForURL('**/login');
    await expect(page.getByRole('heading', { name: /ログイン/i })).toBeVisible();
  });

  test('cTrader認証ボタンが表示される', async ({ page }) => {
    // cTrader認証ボタンの存在確認
    const authButton = page.getByRole('button', { name: /ctrader|認証/i });
    await expect(authButton).toBeVisible();
  });
});
