# テスト環境シークレット管理 - 検証ガイド

## このPRで実装された機能

料金が発生するAPI（AI_API_KEY、MARKET_API_KEY）のテストコストを最小限に抑え、シークレット未設定時もテストが継続実行されるシステムを実装しました。

## 検証項目

### 1. ファイル構成の確認

以下のファイルが正しく作成・更新されていることを確認してください：

```bash
# 新規作成ファイル
src/backend/tests/helpers/secret-checker.ts
src/backend/tests/setup/global-setup.ts
src/backend/tests/secret-checker.test.ts
.github/workflows/test.yml
docs/TEST_SECRET_MANAGEMENT.md
docs/TEST_IMPLEMENTATION_REPORT.md

# 更新ファイル
jest.config.ts
README.md
src/backend/tests/marketIngestService.test.ts
src/backend/tests/aiSummaryService.test.ts
src/backend/tests/enhancedAISummaryService.test.ts
src/side-b/tests/planAIService.test.ts
src/side-b/tests/researchAIService.test.ts
```

### 2. ヘルパー関数のテスト実行

```bash
# ヘルパー関数のテストを実行
npm test -- secret-checker.test.ts
```

**期待される結果**:
```
 PASS  src/backend/tests/secret-checker.test.ts
  Secret Checker Helper
    checkRequiredSecrets
      ✓ 全てのシークレットが設定されている場合は全てtrueを返す
      ✓ シークレットが未設定の場合はfalseを返す
    hasCtraderCredentials
      ✓ 両方のcTraderシークレットが設定されている場合はtrueを返す
      ✓ 片方だけ設定されている場合はfalseを返す
      ✓ 両方とも未設定の場合はfalseを返す
    isMinimalTestMode
      ✓ CI環境でRUN_FULL_PAID_API_TESTS=falseの場合はtrueを返す
      ✓ CI環境でRUN_FULL_PAID_API_TESTS=trueの場合はfalseを返す
      ✓ CI環境でない場合はfalseを返す
    skipIfMissingSecret
      ✓ シークレットが設定されている場合はfalseを返す
      ✓ シークレットが未設定の場合はtrueを返す
    skipIfNotMinimalTest
      ✓ 最小限モードの場合はtrueを返す
      ✓ フルテストモードの場合はfalseを返す
      ✓ ローカル環境の場合はfalseを返す

Test Suites: 1 passed, 1 total
Tests:       13 passed, 13 total
```

### 3. グローバルセットアップの動作確認

```bash
# 全テストを実行してセットアップメッセージを確認
npm test 2>&1 | head -20
```

**期待される出力**:
```
🔧 Test Environment Setup

Test Mode: 🚀 Full  # ローカル環境はフルモード

✅ AI_API_KEY configured - Running FULL tests (multiple API calls)
# または
⚠️  AI_API_KEY not set - AI tests will be skipped

✅ MARKET_API_KEY configured - Running FULL tests (multiple API calls)
# または
⚠️  MARKET_API_KEY not set - Market Data tests will be skipped

✅ cTrader credentials configured - Running ALL tests (no cost limit)
# または
⚠️  cTrader credentials not set - cTrader tests will be skipped
```

### 4. 条件付きスキップの動作確認

#### ケース1: シークレット未設定時のスキップ

```bash
# AI_API_KEY を未設定にして実行
unset AI_API_KEY
npm test -- marketIngestService.test.ts
```

**期待される動作**:
- MARKET_API_KEY が未設定の場合、テストがスキップされる
- エラーは発生せず、スキップされたことが表示される

#### ケース2: 最小限モードでの拡張テストスキップ

```bash
# CI環境をシミュレート
CI=true RUN_FULL_PAID_API_TESTS=false npm test -- marketIngestService.test.ts
```

**期待される動作**:
- 基本テストは実行される
- 拡張テスト（upsert の冪等性テスト）はスキップされる
- スキップメッセージが表示される

### 5. GitHub Actions ワークフローの確認

#### ワークフロー構文チェック

```bash
# GitHub CLIがインストールされている場合
gh workflow view test.yml

# または、ファイルの内容を確認
cat .github/workflows/test.yml
```

**確認ポイント**:
- `workflow_dispatch` が設定されている（手動実行可能）
- `run_full_tests` 入力パラメータがある
- 2つのジョブ条件分岐が正しく設定されている

#### ワークフローの実行（CI環境）

GitHub Actions で以下を確認：

1. **自動実行（Push/PR時）**
   - 最小限モードで実行される
   - テストモードのログが表示される
   - 料金発生APIは最小限のテストのみ

2. **手動実行（Workflow Dispatch）**
   - Actions タブ → Tests → Run workflow
   - `run_full_tests: true` を選択
   - フルモードで実行される
   - 全テストが実行される

### 6. ドキュメントの確認

以下のドキュメントが正しく更新されていることを確認：

```bash
# README.md のテストセクション
grep -A 50 "### テスト" README.md

# 新規ドキュメント
cat docs/TEST_SECRET_MANAGEMENT.md
cat docs/TEST_IMPLEMENTATION_REPORT.md
```

## トラブルシューティング検証

### シナリオ1: 全シークレット未設定

```bash
# 全シークレットを未設定にして実行
unset AI_API_KEY MARKET_API_KEY CTRADER_CLIENT_ID CTRADER_CLIENT_SECRET
npm test
```

**期待される結果**:
- テストスイートは実行される
- 該当テストがスキップされる
- エラーは発生しない
- 警告メッセージが表示される

### シナリオ2: 一部シークレット設定

```bash
# AI_API_KEY のみ設定
export AI_API_KEY=test-key
unset MARKET_API_KEY CTRADER_CLIENT_ID CTRADER_CLIENT_SECRET
npm test
```

**期待される結果**:
- AI関連テストは実行される
- Market Data、cTrader関連テストはスキップされる
- テストスイート全体は成功

### シナリオ3: CI環境での最小限モード

```bash
# CI環境をシミュレート（最小限モード）
export CI=true
export AI_API_KEY=test-key
export MARKET_API_KEY=test-market-key
unset RUN_FULL_PAID_API_TESTS
npm test
```

**期待される結果**:
- テストモード: "💰 Minimal (Cost Optimized)" と表示
- 基本テストのみ実行
- 拡張テストはスキップ

### シナリオ4: CI環境でのフルモード

```bash
# CI環境でフルモード
export CI=true
export RUN_FULL_PAID_API_TESTS=true
export AI_API_KEY=test-key
export MARKET_API_KEY=test-market-key
npm test
```

**期待される結果**:
- テストモード: "🚀 Full" と表示
- 全テスト実行

## パフォーマンス検証

### API呼び出し回数の確認

実際のテスト実行時にAPI呼び出し回数を確認：

**最小限モード**:
- AI API: 1-2回/実行
- Market Data API: 1-2回/実行

**フルモード**:
- AI API: 10-20回/実行（既存テスト次第）
- Market Data API: 5-10回/実行（既存テスト次第）

### コスト削減の検証

月次でのAPI使用量を確認：

```
Before: Push/PR 20回 × 15呼び出し = 300回/月
After:  Push/PR 20回 × 2呼び出し = 40回/月（最小限モード）
       + 手動 2回 × 15呼び出し = 30回/月（フルモード）
       = 合計70回/月

削減率: (300 - 70) / 300 = 76.7%
```

## 問題がある場合

### テストが失敗する

1. **TypeScriptコンパイルエラー**
   ```bash
   npx tsc --noEmit --project tsconfig.test.json
   ```
   - 型定義の問題を確認

2. **依存関係の問題**
   ```bash
   npm ci  # クリーンインストール
   ```

3. **環境変数の問題**
   ```bash
   # .env.test ファイルの確認
   cat .env.test
   ```

### GitHub Actions が動作しない

1. **ワークフロー構文エラー**
   - GitHub Actions タブでエラーを確認
   - YAML構文をチェック

2. **シークレット未設定**
   - Repository Settings → Secrets → Actions
   - 必要なシークレットが設定されているか確認

3. **権限の問題**
   - Workflow permissions を確認
   - Read and write permissions が必要

## 完了チェックリスト

実装が正しく動作していることを確認するための最終チェックリスト：

- [ ] ヘルパー関数のテストが全てパス
- [ ] グローバルセットアップメッセージが表示される
- [ ] シークレット未設定時にテストがスキップされる
- [ ] 最小限モードで拡張テストがスキップされる
- [ ] フルモードで全テストが実行される
- [ ] GitHub Actions ワークフローが正しく設定されている
- [ ] ドキュメントが正しく更新されている
- [ ] 既存テストが正常に動作する

## 次のステップ

検証が完了したら：

1. **PRをマージ**
2. **GitHub Actions で動作確認**
   - Push後に自動実行される（最小限モード）
   - テストログを確認
3. **フルテストを手動実行**
   - Actions → Tests → Run workflow → run_full_tests: true
   - 全テストが実行されることを確認
4. **コスト監視**
   - APIダッシュボードで使用量を確認
   - 削減効果を検証

## サポート

問題がある場合は以下を確認：

1. [docs/TEST_SECRET_MANAGEMENT.md](TEST_SECRET_MANAGEMENT.md) - 詳細実装ガイド
2. [docs/TEST_IMPLEMENTATION_REPORT.md](TEST_IMPLEMENTATION_REPORT.md) - 完了レポート
3. [README.md](../README.md#テスト) - テスト環境セットアップ

または、新しいissueを作成してください。
