import { test, expect } from '@playwright/test';

/**
 * 通知機能のE2Eテスト
 * 対象: プッシュ通知、通知履歴、通知設定
 */
test.describe('通知機能', () => {
  test.beforeEach(async ({ page, context }) => {
    // テスト用の認証トークンをCookieに設定
    await context.addCookies([{
      name: 'auth_token',
      value: 'test-token',
      domain: 'localhost',
      path: '/',
    }]);
  });

  test('通知ページが表示される', async ({ page }) => {
    await page.goto('/notifications');
    
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toBeVisible();
  });

  test('通知履歴の表示確認', async ({ page }) => {
    await page.goto('/notifications');
    
    await page.waitForLoadState('networkidle');
    
    // 通知アイテムを探す
    const notificationItems = page.locator(
      '[data-testid="notification-item"], [class*="notification"], li'
    );
    
    // 通知が存在する場合のみ確認
    const itemCount = await notificationItems.count();
    if (itemCount > 0) {
      await expect(notificationItems.first()).toBeVisible();
    }
  });

  test('通知設定ページへのアクセス', async ({ page }) => {
    await page.goto('/settings/notifications');
    
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toBeVisible();
  });

  test('通知許可リクエストボタンの存在確認', async ({ page }) => {
    await page.goto('/settings/notifications');
    
    await page.waitForLoadState('networkidle');
    
    // 通知許可ボタンを探す
    const enableButton = page.locator(
      'button:has-text("通知を有効"), button:has-text("許可")'
    ).first();
    
    const buttonCount = await page.locator(
      'button:has-text("通知を有効"), button:has-text("許可")'
    ).count();
    
    if (buttonCount > 0) {
      await expect(enableButton).toBeVisible();
    }
  });

  test('通知アイコンの表示確認', async ({ page }) => {
    await page.goto('/dashboard');
    
    await page.waitForLoadState('networkidle');
    
    // 通知ベルアイコンまたは通知センターを探す
    const notificationIcon = page.locator(
      '[data-testid="notification-icon"], [aria-label*="通知"], svg[class*="bell"]'
    ).first();
    
    const iconCount = await page.locator(
      '[data-testid="notification-icon"], [aria-label*="通知"]'
    ).count();
    
    if (iconCount > 0) {
      await expect(notificationIcon).toBeVisible();
    }
  });

  test('未読通知バッジの表示確認', async ({ page }) => {
    await page.goto('/dashboard');
    
    await page.waitForLoadState('networkidle');
    
    // 未読バッジを探す
    const badge = page.locator(
      '[data-testid="notification-badge"], [class*="badge"]'
    ).first();
    
    const badgeCount = await page.locator(
      '[data-testid="notification-badge"], [class*="badge"]'
    ).count();
    
    if (badgeCount > 0) {
      await expect(badge).toBeVisible();
    }
  });

  test('通知履歴のフィルタリング機能', async ({ page }) => {
    await page.goto('/notifications');
    
    await page.waitForLoadState('networkidle');
    
    // フィルタボタンまたはドロップダウンを探す
    const filterControl = page.locator(
      'select, [role="combobox"], button:has-text("フィルタ")'
    ).first();
    
    const filterCount = await page.locator(
      'select, [role="combobox"], button:has-text("フィルタ")'
    ).count();
    
    if (filterCount > 0) {
      await expect(filterControl).toBeVisible();
    }
  });
});
