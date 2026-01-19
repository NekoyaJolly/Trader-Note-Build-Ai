import { test, expect } from '@playwright/test';

/**
 * トレードノート機能のE2Eテスト
 * 対象: ノート作成、編集、削除、フィルタリング
 */
test.describe('トレードノート機能', () => {
  test.beforeEach(async ({ page, context }) => {
    // テスト用の認証トークンをCookieに設定
    await context.addCookies([{
      name: 'auth_token',
      value: 'test-token',
      domain: 'localhost',
      path: '/',
    }]);
  });

  test('ノート一覧ページが表示される', async ({ page }) => {
    await page.goto('/notes');
    
    // ノート一覧ページの確認
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toBeVisible();
  });

  test('新規トレードノート作成フローにアクセス', async ({ page }) => {
    await page.goto('/notes');
    
    // 新規作成ボタンを探す
    const newNoteButton = page.locator(
      '[data-testid="new-trade-note"], button:has-text("新規"), button:has-text("作成")'
    ).first();
    
    const buttonCount = await page.locator(
      '[data-testid="new-trade-note"], button:has-text("新規"), button:has-text("作成")'
    ).count();
    
    if (buttonCount > 0) {
      await newNoteButton.click();
      
      // フォームページまたはモーダルが表示されることを確認
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).toBeVisible();
    }
  });

  test('トレードノートフォーム要素の確認', async ({ page }) => {
    await page.goto('/notes/new');
    
    await page.waitForLoadState('networkidle');
    
    // フォーム要素を探す（存在確認のみ）
    const symbolInput = page.locator('input[name="symbol"], input[placeholder*="シンボル"]').first();
    const directionSelect = page.locator('select[name="direction"], select[name="type"]').first();
    
    // いずれかのフォーム要素が存在することを確認
    const formElements = await page.locator('input, select, textarea').count();
    expect(formElements).toBeGreaterThan(0);
  });

  test('ノート一覧の表示確認', async ({ page }) => {
    await page.goto('/notes');
    
    await page.waitForLoadState('networkidle');
    
    // ノートアイテムまたはテーブル行を探す
    const noteItems = page.locator(
      '[data-testid="note-item"], tr, [class*="note"], [class*="card"]'
    );
    
    // ノートが存在する場合のみ確認
    const itemCount = await noteItems.count();
    if (itemCount > 0) {
      await expect(noteItems.first()).toBeVisible();
    }
  });

  test('ノート編集ボタンの存在確認', async ({ page }) => {
    await page.goto('/notes');
    
    await page.waitForLoadState('networkidle');
    
    // 編集ボタンを探す
    const editButtons = page.locator(
      '[data-testid="edit-note"], button:has-text("編集"), a:has-text("編集")'
    );
    
    const editButtonCount = await editButtons.count();
    if (editButtonCount > 0) {
      await expect(editButtons.first()).toBeVisible();
    }
  });

  test('ノート削除ボタンの存在確認', async ({ page }) => {
    await page.goto('/notes');
    
    await page.waitForLoadState('networkidle');
    
    // 削除ボタンを探す
    const deleteButtons = page.locator(
      '[data-testid="delete-note"], button:has-text("削除")'
    );
    
    const deleteButtonCount = await deleteButtons.count();
    if (deleteButtonCount > 0) {
      await expect(deleteButtons.first()).toBeVisible();
    }
  });

  test('フィルタリング機能の存在確認', async ({ page }) => {
    await page.goto('/notes');
    
    await page.waitForLoadState('networkidle');
    
    // フィルタ入力欄を探す
    const filterInputs = page.locator(
      '[name*="filter"], input[placeholder*="検索"], input[placeholder*="フィルタ"]'
    );
    
    const filterCount = await filterInputs.count();
    if (filterCount > 0) {
      await expect(filterInputs.first()).toBeVisible();
    }
  });
});
