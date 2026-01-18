# TradeAssist テスト戦略

## 概要

TradeAssistでは、以下の3層のテスト戦略を採用しています:

1. **Unit Tests** (Jest) - 個別関数・モジュールのテスト
2. **E2E Tests** (Playwright) - ブラウザ自動テスト
3. **AI-Driven Tests** - AIエージェントによる包括的テスト

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

# AIテスト用（オプション）
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
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
```

### 3. AI駆動テスト

```bash
# AIテストオーケストレーター実行
npm run test:ai

# 環境変数指定
OPENAI_API_KEY=sk-... npm run test:ai

# ヘッドレスモード無効化（動作を確認）
HEADLESS=false npm run test:ai
```

### レポート確認

```bash
# Playwright HTMLレポート表示
npm run test:e2e:report

# AIテストレポート確認
cat playwright-report/ai-test-report.json

# テスト動画確認（失敗時のみ生成）
ls test-videos/
```

## テストカバレッジ

### 現在のカバレッジ

| 機能 | Unit | E2E | AI |
|------|------|-----|-----|
| 認証（cTrader OAuth） | ✅ | ✅ | 🔄 |
| トレードノート作成・編集・削除 | ✅ | ✅ | 🔄 |
| ダッシュボード表示 | ✅ | ✅ | 🔄 |
| 市場データ一致判定 | ✅ | ⚠️ | 🔄 |
| 通知機能 | ✅ | ⚠️ | 🔄 |
| チャート操作 | ⚠️ | ⚠️ | 🔄 |
| プロファイル管理 | ✅ | ⚠️ | 🔄 |

凡例: ✅ 完了 | ⚠️ 部分的 | 🔄 計画中

### テストファイル構成

```
tests/
├── e2e/                          # E2Eテスト
│   ├── auth.spec.ts              # 認証フロー
│   ├── dashboard.spec.ts         # ダッシュボード
│   ├── trade-notes.spec.ts       # トレードノート
│   ├── market-data.spec.ts       # 市場データ
│   └── notifications.spec.ts     # 通知機能
├── ai-orchestrator/              # AIテストオーケストレーター
│   ├── ai-test-runner.ts         # GPT-4連携
│   ├── claude-computer-use.ts    # Claude連携
│   └── test-scenarios.json       # 生成されたシナリオ
└── fixtures/
    └── test-data.ts              # テストデータ
```

## CI/CD統合

### GitHub Actions

プロジェクトには2つのE2Eテストワークフローがあります:

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

#### 2. AI駆動テスト（スケジュール実行）

- **トリガー**: 毎日午前3時（JST）、手動実行
- **対象**: AIオーケストレーター
- **実行時間**: 約15-30分
- **注意**: OpenAI/Anthropic API使用により課金発生

```yaml
on:
  schedule:
    - cron: '0 18 * * *'  # UTC 18:00 = JST 3:00
  workflow_dispatch:
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

#### Q: AI APIエラー

- `OPENAI_API_KEY`が正しく設定されているか確認
- APIレート制限に達していないか確認
- API残高を確認

```bash
# 環境変数確認
echo $OPENAI_API_KEY
echo $ANTHROPIC_API_KEY
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

## AI駆動テストの詳細

### AIテストオーケストレーター

**機能:**
- GPT-4を使用してテストシナリオを自動生成
- UI画面を解析して次のアクションを決定
- テスト結果を自動検証

**使用例:**

```typescript
const orchestrator = new AITestOrchestrator();
await orchestrator.initialize();

// AIがシナリオを生成
const scenarios = await orchestrator.generateTestScenarios('ログイン機能');

// シナリオ実行
for (const scenario of scenarios) {
  await orchestrator.runScenario(scenario);
}

// レポート生成
await orchestrator.generateReport();
```

### Claude Computer Use

**機能:**
- Claude 3.5 Sonnetのコンピュータ操作機能を使用
- 画面を見ながら自動的に操作
- 人間に近い動作で複雑なフローをテスト

**使用例:**

```typescript
const agent = new ClaudeComputerUseAgent();
await agent.initialize('http://localhost:3102');

const result = await agent.runTest(`
1. ログインする
2. ダッシュボードを確認
3. トレードノートを作成
4. 保存を確認
`);

console.log('テスト結果:', result.success ? '成功' : '失敗');
```

### コスト管理

AIテストは課金が発生するため、以下に注意:

- **OpenAI API**:
  - gpt-4-vision-preview: 約$0.01-0.03/リクエスト
  - 1シナリオ（5ステップ）: 約$0.10-0.20

- **Anthropic API**:
  - claude-3-5-sonnet: 約$0.015/1000トークン
  - 1テスト実行: 約$0.05-0.15

**推奨:**
- ローカルテストは手動で実行
- CIでは重要機能のみAIテスト
- 毎日のスケジュール実行を監視

## 今後の拡張

- [ ] ビジュアルリグレッションテスト（Percy/Chromatic）
- [ ] パフォーマンステスト（Lighthouse CI）
- [ ] アクセシビリティテスト（axe-core）
- [ ] モバイルブラウザテスト
- [ ] クロスブラウザテスト（Firefox, Safari）
- [ ] ロードテスト（k6）

## 参考資料

- [Playwright公式ドキュメント](https://playwright.dev/)
- [OpenAI Vision API](https://platform.openai.com/docs/guides/vision)
- [Claude Computer Use](https://docs.anthropic.com/claude/docs/computer-use)
- [Jest公式ドキュメント](https://jestjs.io/)

## サポート

テストに関する質問や問題は、GitHubのIssueで報告してください。
