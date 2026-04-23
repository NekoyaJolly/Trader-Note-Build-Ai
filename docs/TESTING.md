# TradeAssist テスト戦略

## 概要

TradeAssistでは、以下の2層のテスト戦略を採用しています:

1. **Unit Tests** (Jest) - 個別関数・モジュールのテスト
2. **E2E Tests** (Playwright) - ブラウザ自動テスト

## セットアップ

### 前提条件

- Node.js 18以上
- PostgreSQL 15以上
- Chromiumブラウザ（Playwrightが自動インストール）

### Playwrightのインストール

```bash
# プロジェクトの依存関係をインストール
npm install

# Playwrightブラウザをインストール
npx playwright install chromium
```

### 環境変数設定

`.env`ファイルに以下を追加（E2Eテスト用）:

```bash
# データベース（テスト用）
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/tradeassist_test
```

## テスト実行

### 1. Unit Tests (Jest)

```bash
# 全ユニットテスト実行
npm test

# カバレッジ付き
npm test -- --coverage

# ウォッチモード
npm test -- --watch

# 特定のテストファイルのみ
npm test -- src/backend/tests/tradeNoteService.test.ts
```

### 2. E2E Tests (Playwright)

```bash
# 全E2Eテスト実行
npm run test:e2e

# UIモードで実行（デバッグ用）
npm run test:e2e:ui

# デバッグモードで実行
npm run test:e2e:debug

# 特定のテストファイルのみ
npx playwright test tests/e2e/auth.spec.ts

# ヘッドフルモードで実行（ブラウザ表示）
HEADLESS=false npm run test:e2e

# 特定のブラウザで実行
npx playwright test --project=chromium

# サーバーが既に起動している場合（webServer自動起動をスキップ）
SKIP_WEBSERVER=1 npm run test:e2e
```

**注意**: 
- デフォルトでは、Playwrightが自動的に開発サーバーを起動します
- サーバーを手動で起動している場合は `SKIP_WEBSERVER=1` を使用してください
- CI環境では必要な環境変数が自動的に設定されます

### レポート確認

```bash
# Playwright HTMLレポート表示
npm run test:e2e:report

# テスト動画確認（失敗時のみ生成）
ls test-videos/
```

## テストカバレッジ

### 現在のカバレッジ

| 機能 | Unit | E2E |
|------|------|-----|
| 認証（cTrader OAuth） | ✅ | ✅ |
| トレードノート作成・編集・削除 | ✅ | ✅ |
| ダッシュボード表示 | ✅ | ✅ |
| 市場データ一致判定 | ✅ | ⚠️ |
| 通知機能 | ✅ | ⚠️ |
| チャート操作 | ⚠️ | ⚠️ |
| プロファイル管理 | ✅ | ⚠️ |

凡例: ✅ 完了 | ⚠️ 部分的

### テストファイル構成

```
tests/
├── e2e/                          # E2Eテスト
│   ├── auth.spec.ts              # 認証フロー
│   ├── dashboard.spec.ts         # ダッシュボード
│   ├── trade-notes.spec.ts       # トレードノート
│   ├── market-data.spec.ts       # 市場データ
│   └── notifications.spec.ts     # 通知機能
└── fixtures/
    └── test-data.ts              # テストデータ
```

## CI/CD統合

### GitHub Actions

プロジェクトには2つのE2Eテストワークフローがあります:

**📝 シークレット設定が必要**: GitHub Actionsでテストを実行するには、環境変数シークレットの設定が必要です。
詳細は [docs/GITHUB_SECRETS_SETUP.md](GITHUB_SECRETS_SETUP.md) を参照してください。

**⚠️ シークレット未設定時の動作**:
- 必須シークレット（DB、JWT）が未設定の場合、テストは失敗します
- オプションシークレット（API キー）が未設定の場合、該当機能のテストがスキップまたは失敗します
- 最低限、`TEST_DB_*` と `JWT_*` のシークレットを設定してください

#### 1. 基本E2Eテスト（自動実行）

- **トリガー**: プッシュ、プルリクエスト
- **対象**: 全E2Eテスト
- **実行時間**: 約5-10分

```yaml
# .github/workflows/e2e-tests.yml
on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main, develop ]
```

### ローカルでCI環境を再現

```bash
# PostgreSQL起動（Docker使用）
docker run -d \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=tradeassist_test \
  -p 5432:5432 \
  postgres:15

# DB セットアップ
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/tradeassist_test \
  npm run prisma:migrate

# E2Eテスト実行
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/tradeassist_test \
  npm run test:e2e
```

## トラブルシューティング

### よくある問題

#### Q: テストがタイムアウトする

```bash
# タイムアウト時間を延長
npx playwright test --timeout=60000

# または playwright.config.ts で設定
timeout: 60000
```

#### Q: スクリーンショットが撮れない

```bash
# ヘッドフルモードで実行
HEADLESS=false npm run test:e2e

# スクリーンショット保存ディレクトリを確認
ls playwright-report/screenshots/
```

#### Q: webServerが起動しない / タイムアウトする

Playwrightは自動的に開発サーバーを起動しようとしますが、環境変数が不足している場合や依存関係が不足している場合に失敗します。

```bash
# 解決策1: 必要な環境変数を設定
cp .env.example .env
# .env を編集して DATABASE_URL, JWT_SECRET などを設定

# 解決策2: サーバーを手動で起動してからテスト実行
npm run dev  # 別ターミナルで実行
SKIP_WEBSERVER=1 npm run test:e2e  # テスト実行

# 解決策3: データベースをセットアップ
npm run prisma:generate
npm run prisma:migrate
```

#### Q: データベース接続エラー

```bash
# PostgreSQL が起動しているか確認
pg_isready -h localhost -p 5432

# 接続URLが正しいか確認
echo $DATABASE_URL

# マイグレーション再実行
npm run prisma:migrate
```

#### Q: ブラウザが起動しない

```bash
# Playwrightブラウザを再インストール
npx playwright install --with-deps chromium

# システム依存関係を確認（Ubuntu/Debian）
sudo apt-get install -y \
  libwoff1 \
  libopus0 \
  libwebp7 \
  libwebpdemux2 \
  libenchant-2-2 \
  libgudev-1.0-0 \
  libsecret-1-0 \
  libhyphen0 \
  libgdk-pixbuf2.0-0 \
  libegl1 \
  libnotify4 \
  libxslt1.1 \
  libevent-2.1-7 \
  libgles2 \
  libvpx7
```

#### Q: フロントエンドが起動しない

```bash
# フロントエンドの依存関係を再インストール
cd src/frontend
rm -rf node_modules .next
npm install
npm run build

# ポート3102が使用中の場合
lsof -ti :3102 | xargs kill -9
```

## ベストプラクティス

### 1. data-testid属性を使用

UI要素に `data-testid` を付与してセレクタを安定化:

```tsx
// Good
<button data-testid="submit-button">送信</button>

// Bad（テキストが変わると壊れる）
<button>送信</button>
```

### 2. テストの独立性

各テストは他のテストに依存しない:

```typescript
// Good
test.beforeEach(async ({ page, context }) => {
  // 各テストで認証状態を設定
  await context.addCookies([...]);
});

// Bad
test('test1', async () => { /* ログイン */ });
test('test2', async () => { /* test1に依存 */ });
```

### 3. クリーンアップ

テスト後はデータベースをリセット:

```typescript
test.afterEach(async () => {
  // テストデータをクリーンアップ
  await prisma.tradeNote.deleteMany();
});
```

### 4. スクリーンショット活用

失敗時のデバッグに活用:

```typescript
test('example', async ({ page }) => {
  await page.screenshot({ path: 'debug.png' });
  // テスト実行
});
```

### 5. ネットワークモック

外部APIをモック化:

```typescript
await page.route('**/api/market-data', route => {
  route.fulfill({
    status: 200,
    body: JSON.stringify({ price: 150.50 })
  });
});
```

## 今後の拡張

- [ ] ビジュアルリグレッションテスト（Percy/Chromatic）
- [ ] パフォーマンステスト（Lighthouse CI）
- [ ] アクセシビリティテスト（axe-core）
- [ ] モバイルブラウザテスト
- [ ] クロスブラウザテスト（Firefox, Safari）
- [ ] ロードテスト（k6）

## 参考資料

- [Playwright公式ドキュメント](https://playwright.dev/)
- [Jest公式ドキュメント](https://jestjs.io/)

## サポート

テストに関する質問や問題は、GitHubのIssueで報告してください。
