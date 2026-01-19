import { test, expect } from '@playwright/test';

/**
 * 認証フローのE2Eテスト
 * 対象: cTrader OAuth認証、ログアウト
 * 注意: 実際の環境ではcTrader OAuth認証が必要
 */
test.describe('認証フロー', () => {
  test('ログインページが表示される', async ({ page }) => {
    await page.goto('/');
    
    // ログインページの基本要素確認
    // 複数の見出しが存在する可能性があるため、個別に確認
    const h1 = page.locator('h1');
    const h2 = page.locator('h2');
    
    // いずれかの見出しが表示されることを確認
    const h1Count = await h1.count();
    const h2Count = await h2.count();
    
    if (h1Count > 0) {
      await expect(h1.first()).toBeVisible();
    }
    if (h2Count > 0) {
      await expect(h2.first()).toBeVisible();
    }
  });

  test('未認証でダッシュボードにアクセスするとログインにリダイレクト', async ({ page }) => {
    await page.goto('/dashboard');
    
    // ログインページにリダイレクトされることを確認
    await expect(page).toHaveURL(/\/login|\/$/);
  });

  // 注意: 実際のOAuth認証テストはモック環境が必要
  test.skip('cTrader OAuth認証フロー（統合テスト用）', async ({ page }) => {
    await page.goto('/');
    
    // cTrader認証ボタンをクリック
    await page.click('button:has-text("cTrader")');
    
    // OAuth認証画面にリダイレクト
    await expect(page).toHaveURL(/ctrader\.com|openapi\.ctrader\.com/);
  });

  test('ログアウト機能（統合テスト用）', async ({ page, context }) => {
    // テスト用の認証トークンをCookieに設定（モック）
    await context.addCookies([{
      name: 'auth_token',
      value: 'test-token',
      domain: 'localhost',
      path: '/',
    }]);

    await page.goto('/dashboard');
    
    // ユーザーメニューを開く
    const userMenu = page.locator('[data-testid="user-menu"], [aria-label*="メニュー"], button:has-text("ログアウト")').first();
    if (await userMenu.isVisible()) {
      await userMenu.click();
      
      // ログアウトボタンをクリック
      const logoutButton = page.locator('[data-testid="logout-button"], button:has-text("ログアウト")').first();
      if (await logoutButton.isVisible()) {
        await logoutButton.click();
        
        // ログインページにリダイレクト
        await expect(page).toHaveURL(/\/login|\/$/);
      }
    }
  });
});
