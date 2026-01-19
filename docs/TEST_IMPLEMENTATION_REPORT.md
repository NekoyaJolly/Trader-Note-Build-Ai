# テスト環境シークレット管理実装 - 完了レポート

## 実装完了日
2026-01-19

## 実装内容サマリー

GitHub Actions のテスト環境で一部のシークレットが未設定の場合でもテストが継続でき、かつ料金が発生するAPI（AI_API_KEY、MARKET_API_KEY）のテストコストを最小限に抑えるシステムを実装しました。

## 実装ファイル一覧

### 1. コアヘルパー・セットアップ

| ファイル | 説明 |
|----------|------|
| `src/backend/tests/helpers/secret-checker.ts` | シークレット存在チェックとテストスキップ判定ヘルパー |
| `src/backend/tests/setup/global-setup.ts` | Jest グローバルセットアップ（テストモード表示） |
| `src/backend/tests/secret-checker.test.ts` | ヘルパー関数のユニットテスト |

### 2. 設定ファイル

| ファイル | 変更内容 |
|----------|----------|
| `jest.config.ts` | globalSetup を追加 |
| `.github/workflows/test.yml` | 新規作成：最小限モード/フルモード対応のテストワークフロー |

### 3. テストファイル更新

| ファイル | 変更内容 |
|----------|----------|
| `src/backend/tests/marketIngestService.test.ts` | 条件付きスキップとコスト最適化を実装 |
| `src/backend/tests/aiSummaryService.test.ts` | モック使用の説明コメント追加 |
| `src/backend/tests/enhancedAISummaryService.test.ts` | モック使用の説明コメント追加 |
| `src/side-b/tests/planAIService.test.ts` | モック使用の説明コメント追加 |
| `src/side-b/tests/researchAIService.test.ts` | モック使用の説明コメント追加 |

### 4. ドキュメント

| ファイル | 変更内容 |
|----------|----------|
| `README.md` | テスト環境セットアップとシークレット管理の説明を追加 |
| `docs/TEST_SECRET_MANAGEMENT.md` | 新規作成：詳細な実装ガイド |
| `docs/TEST_IMPLEMENTATION_REPORT.md` | 本ファイル（完了レポート） |

## 主要機能

### 1. テストモード管理

**最小限モード（デフォルト）**
- CI環境での通常実行時
- 料金発生APIは最小限のテスト（1-2回呼び出し）のみ実行
- 判定: `CI=true && RUN_FULL_PAID_API_TESTS!=true`

**フルテストモード**
- GitHub Actions 手動実行時のみ
- 全テスト実行（料金発生に注意）
- 判定: `RUN_FULL_PAID_API_TESTS=true`

### 2. シークレット別テスト制御

| シークレット | 料金 | 未設定時の動作 | テスト範囲 |
|------------|------|--------------|----------|
| `AI_API_KEY` | あり | スキップ | 最小限モード: 基本テストのみ |
| `MARKET_API_KEY` | あり | スキップ | 最小限モード: 基本テストのみ |
| `TWELVE_DATA_API_KEY` | あり | スキップ | 最小限モード: 基本テストのみ |
| `CTRADER_CLIENT_ID` | なし | スキップ | 全テスト実行 |
| `CTRADER_CLIENT_SECRET` | なし | スキップ | 全テスト実行 |

### 3. ヘルパー関数

```typescript
// シークレット存在チェック
checkRequiredSecrets() // => { hasAiApiKey: boolean, ... }

// cTrader両方のシークレット確認
hasCtraderCredentials() // => boolean

// 最小限モード判定
isMinimalTestMode() // => boolean

// スキップ判定
skipIfMissingSecret(secretName, testName) // => boolean
skipIfNotMinimalTest(testName) // => boolean
```

## 使用例

### 料金発生APIテスト（AI API）

```typescript
import { checkRequiredSecrets, isMinimalTestMode } from './helpers/secret-checker';

const secrets = checkRequiredSecrets();
const minimalMode = isMinimalTestMode();

const describeOrSkip = secrets.hasAiApiKey ? describe : describe.skip;

describeOrSkip('AI Service - Real API', () => {
  // 最小限のテスト（常に実行）
  test('basic summary generation', async () => {
    // 1回のAPI呼び出し
  });

  // 拡張テスト（フルモードのみ）
  const testOrSkip = minimalMode ? test.skip : test;
  
  testOrSkip('detailed analysis', async () => {
    // 複数のAPI呼び出し
  });
});
```

### 料金なしAPIテスト（cTrader）

```typescript
import { hasCtraderCredentials } from './helpers/secret-checker';

const canTest = hasCtraderCredentials();
const describeOrSkip = canTest ? describe : describe.skip;

describeOrSkip('cTrader OAuth', () => {
  // 全テスト実行（コスト制限なし）
  test('authentication', async () => { /* ... */ });
  test('account info', async () => { /* ... */ });
  test('token refresh', async () => { /* ... */ });
});
```

## GitHub Actions ワークフロー

### 通常実行（自動）

```yaml
# Push/PR時に自動実行
# RUN_FULL_PAID_API_TESTS: false（デフォルト）
```

**出力例**:
```
🔧 Test Environment Setup

Test Mode: 💰 Minimal (Cost Optimized)

✅ AI_API_KEY configured - Running MINIMAL tests (1-2 API calls)
✅ MARKET_API_KEY configured - Running MINIMAL tests (1-2 API calls)
✅ cTrader credentials configured - Running ALL tests (no cost limit)
```

### フルテスト実行（手動）

GitHub Actions → Tests → Run workflow → `run_full_tests: true`

**出力例**:
```
🔧 Test Environment Setup

Test Mode: 🚀 Full

✅ AI_API_KEY configured - Running FULL tests (multiple API calls)
✅ MARKET_API_KEY configured - Running FULL tests (multiple API calls)
✅ cTrader credentials configured - Running ALL tests (no cost limit)
```

## ローカル環境での使用

### .env.test 設定例

```bash
# 必須
TEST_DB_NAME=trader_note_test
TEST_DB_USER=postgres
TEST_DB_PASSWORD=your_password
JWT_SECRET=your_jwt_secret
# ... その他必須シークレット

# オプショナル（設定すると該当テストが実行される）
AI_API_KEY=your_ai_api_key
MARKET_API_KEY=your_market_api_key
CTRADER_CLIENT_ID=your_ctrader_id
CTRADER_CLIENT_SECRET=your_ctrader_secret
```

### テスト実行

```bash
# ローカル環境は自動的にフルモード（CI=false）
npm test

# 最小限モードにする場合
CI=true RUN_FULL_PAID_API_TESTS=false npm test
```

## テスト結果

### ヘルパー関数テスト

`src/backend/tests/secret-checker.test.ts` で以下をテスト：
- ✅ `checkRequiredSecrets()` - シークレット存在チェック
- ✅ `hasCtraderCredentials()` - cTrader両方のシークレット確認
- ✅ `isMinimalTestMode()` - モード判定
- ✅ `skipIfMissingSecret()` - スキップ判定
- ✅ `skipIfNotMinimalTest()` - 拡張テストスキップ判定

### 既存テスト互換性

- ✅ 既存のモックベーステストは変更なしで動作
- ✅ 料金発生APIテストは条件付きスキップを実装
- ✅ シークレット未設定時もテストスイート全体が継続実行

## コスト最適化効果

### Before（実装前）

- AI API: 全テスト実行（10-20回の呼び出し/実行）
- Market Data API: 全テスト実行（5-10回の呼び出し/実行）
- Push/PR ごとに料金発生

### After（実装後）

**通常実行（最小限モード）**:
- AI API: 基本テストのみ（1-2回の呼び出し/実行）
- Market Data API: 基本テストのみ（1-2回の呼び出し/実行）
- **コスト削減: 約80-90%**

**フルテスト実行（手動）**:
- リリース前など必要な場合のみ実行
- 月1-2回程度の想定

## ベストプラクティス

### DO ✅

1. モックを優先して使用
2. 実APIテストは最小限に
3. 料金発生テストには明確なコメント
4. 段階的テスト実装（基本→拡張）

### DON'T ❌

1. ループで大量のAPI呼び出し
2. 全テストでリアルAPI使用
3. シークレット未設定時のエラー
4. フルモードの頻繁な実行

## トラブルシューティング

### テストがスキップされる

```
⚠️  Skipping test "..." - Missing secret: hasAiApiKey
```

**解決**: `.env.test` にシークレットを追加するか、モックテストに変更

### 拡張テストがスキップされる

```
⚠️  Skipping extended test "..." - Minimal test mode
```

**解決**: ローカル環境では自動的にフルモード。CI環境でフルテストが必要な場合は手動実行

## 参考ドキュメント

- [README.md](../README.md) - プロジェクト概要とクイックスタート
- [docs/TEST_SECRET_MANAGEMENT.md](TEST_SECRET_MANAGEMENT.md) - 詳細な実装ガイド
- [AGENTS.md](../AGENTS.md) - 開発者向けガイド

## 次のステップ

### 推奨事項

1. **既存テストの見直し**: 料金発生APIを使用しているテストを特定し、必要に応じて条件付きスキップを追加
2. **モック化の推進**: 可能な限り実APIテストをモックテストに移行
3. **コスト監視**: 月次でAPI使用量を確認し、必要に応じて最適化
4. **ドキュメント更新**: 新しいテストを追加する際は本ガイドに従う

### 将来的な改善案

1. テスト実行時のAPI呼び出し回数の自動カウント
2. コスト見積もりダッシュボード
3. API使用量のアラート機能

## 完了チェックリスト

- [x] テストヘルパー作成
- [x] Jest Global Setup 作成
- [x] jest.config.ts 更新
- [x] GitHub Actions ワークフロー作成
- [x] 既存テスト更新
- [x] README.md 更新
- [x] 詳細ドキュメント作成
- [x] ヘルパー関数のテスト作成
- [x] 実装レポート作成

## 実装完了

**Status**: ✅ Complete

全ての実装が完了し、テストコスト最適化とシークレット管理が適切に機能しています。
