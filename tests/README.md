# TradeAssist テストディレクトリ

このディレクトリには、TradeAssistアプリケーションのE2EテストとAI駆動テストが含まれています。

## ディレクトリ構成

```
tests/
├── e2e/                          # Playwright E2Eテスト
│   ├── auth.spec.ts              # 認証フロー（cTrader OAuth）
│   ├── dashboard.spec.ts         # ダッシュボード表示
│   ├── trade-notes.spec.ts       # トレードノート機能
│   ├── market-data.spec.ts       # 市場データ一致判定
│   └── notifications.spec.ts     # 通知機能
├── ai-orchestrator/              # AI駆動テスト
│   ├── ai-test-runner.ts         # GPT-4ベースのテストオーケストレーター
│   ├── claude-computer-use.ts    # Claude Computer Use統合
│   └── test-scenarios.json       # AIが生成したテストシナリオ（自動生成）
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

### 3. AI駆動テストの実行

**注意**: OpenAI/Anthropic APIキーが必要です。

```bash
# 環境変数を設定
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...

# AIテスト実行
npm run test:ai

# 動作確認（ブラウザ表示）
HEADLESS=false npm run test:ai
```

## テストの説明

### E2Eテスト (Playwright)

通常のブラウザ自動テストです。事前に定義されたシナリオを実行します。

- **auth.spec.ts**: ログイン、ログアウト、認証エラー
- **dashboard.spec.ts**: ダッシュボードの表示、チャート、リアルタイムデータ
- **trade-notes.spec.ts**: ノート作成、編集、削除、フィルタリング
- **market-data.spec.ts**: 市場データ表示、一致判定
- **notifications.spec.ts**: 通知履歴、設定、プッシュ通知

### AI駆動テスト

AIがUI画面を解析し、テストシナリオを生成・実行します。

#### GPT-4テストオーケストレーター

- UI画面のスクリーンショットを解析
- 次のアクションを自動決定
- 実行結果を検証

```typescript
// 使用例
const orchestrator = new AITestOrchestrator();
await orchestrator.initialize();

// AIがシナリオを生成
const scenarios = await orchestrator.generateTestScenarios('ログイン機能');

// シナリオ実行
for (const scenario of scenarios) {
  await orchestrator.runScenario(scenario);
}
```

#### Claude Computer Use

- Claude 3.5 Sonnetのコンピュータ操作機能を使用
- より人間に近い動作でテスト実行

```typescript
// 使用例
const agent = new ClaudeComputerUseAgent();
await agent.initialize('http://localhost:3102');

const result = await agent.runTest(`
1. ログインする
2. トレードノートを作成
3. 保存を確認
`);
```

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

### Q: AI APIエラー

- 環境変数が正しく設定されているか確認
- APIクォータを確認

```bash
echo $OPENAI_API_KEY
echo $ANTHROPIC_API_KEY
```

## 詳細ドキュメント

詳細なテスト戦略とガイドラインは [docs/TESTING.md](../docs/TESTING.md) を参照してください。

## CI/CD統合

GitHub Actionsで自動実行されます:

- **プッシュ/PR時**: E2Eテスト実行
- **毎日午前3時（JST）**: 全テスト + AIテスト実行

ワークフロー: [.github/workflows/e2e-tests.yml](../.github/workflows/e2e-tests.yml)
