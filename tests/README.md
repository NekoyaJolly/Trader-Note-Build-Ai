# TradeAssist テストディレクトリ

このディレクトリには、TradeAssistアプリケーションのE2Eテストが含まれています。

## ディレクトリ構成

```
tests/
├── e2e/                          # Playwright E2Eテスト
│   ├── auth.spec.ts              # 認証フロー（cTrader OAuth）
│   ├── dashboard.spec.ts         # ダッシュボード表示
│   ├── trade-notes.spec.ts       # トレードノート機能
│   ├── market-data.spec.ts       # 市場データ一致判定
│   └── notifications.spec.ts     # 通知機能
└── fixtures/                     # テストデータ
    └── test-data.ts              # テスト用のモックデータ
```

## クイックスタート

### 1. 依存関係のインストール

```bash
# プロジェクトルートで実行
npm install

# Playwrightブラウザのインストール
npx playwright install chromium
```

### 2. E2Eテストの実行

```bash
# 全E2Eテスト実行
npm run test:e2e

# UIモードで実行（おすすめ）
npm run test:e2e:ui

# 特定のテストのみ実行
npx playwright test tests/e2e/auth.spec.ts

# ヘッドフルモード（ブラウザ表示）
HEADLESS=false npm run test:e2e
```

## テストの説明

### E2Eテスト (Playwright)

ブラウザ自動テストです。事前に定義されたシナリオを実行します。

- **auth.spec.ts**: ログイン、ログアウト、認証エラー
- **dashboard.spec.ts**: ダッシュボードの表示、チャート、リアルタイムデータ
- **trade-notes.spec.ts**: ノート作成、編集、削除、フィルタリング
- **market-data.spec.ts**: 市場データ表示、一致判定
- **notifications.spec.ts**: 通知履歴、設定、プッシュ通知

## テストのベストプラクティス

### 1. data-testid属性を使用

```tsx
// 良い例
<button data-testid="submit-button">送信</button>

// 避けるべき
<button>送信</button>  // テキストが変わると壊れる
```

### 2. 独立したテスト

各テストは他のテストに依存しないようにする：

```typescript
test.beforeEach(async ({ page, context }) => {
  // 各テストで認証状態をリセット
  await context.addCookies([...]);
});
```

### 3. 適切な待機

```typescript
// 良い例
await page.waitForLoadState('networkidle');
await expect(element).toBeVisible();

// 避けるべき
await page.waitForTimeout(5000);  // 固定時間待機
```

## トラブルシューティング

### Q: テストがタイムアウトする

```bash
# タイムアウト時間を延長
npx playwright test --timeout=60000
```

### Q: ブラウザが起動しない

```bash
# Playwrightを再インストール
npx playwright install --with-deps chromium
```

## 詳細ドキュメント

詳細なテスト戦略とガイドラインは [docs/TESTING.md](../docs/TESTING.md) を参照してください。

## CI/CD統合

GitHub Actionsで自動実行されます:

- **プッシュ/PR時**: Unit Tests + E2E Tests
- **スケジュール（毎日 UTC 18:00）**: セキュリティ監査

ワークフロー: [.github/workflows/ci.yml](../.github/workflows/ci.yml)
