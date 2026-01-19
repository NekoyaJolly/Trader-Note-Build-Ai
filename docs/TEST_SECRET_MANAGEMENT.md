# テスト環境のシークレット管理とコスト最適化ガイド

## 概要

このガイドでは、料金が発生するAPI（AI_API_KEY、MARKET_API_KEY）のテストコストを最小限に抑えつつ、テストカバレッジを維持する方法を説明します。

## テストモード

### 最小限テストモード（デフォルト）

**対象環境**: CI/CD環境（GitHub Actions）の通常実行時

**特徴**:
- 料金が発生するAPIは最小限のテスト（1-2回の呼び出し）のみ実行
- cTrader APIは料金がかからないため全テスト実行
- シークレット未設定時は該当テストをスキップ

**判定条件**:
```typescript
process.env.CI === 'true' && process.env.RUN_FULL_PAID_API_TESTS !== 'true'
```

### フルテストモード

**対象環境**: GitHub Actions の手動実行時

**特徴**:
- 全てのテストを実行（料金発生に注意）
- リリース前の最終検証などに使用

**有効化方法**:
GitHub Actions の Workflow Dispatch で `run_full_tests: true` を選択

## ヘルパー関数

### `checkRequiredSecrets()`

環境変数に各シークレットが設定されているかをチェック。

```typescript
const secrets = checkRequiredSecrets();
// {
//   hasAiApiKey: boolean,
//   hasMarketApiKey: boolean,
//   hasCtraderClientId: boolean,
//   hasCtraderClientSecret: boolean,
// }
```

### `hasCtraderCredentials()`

cTrader の両方のシークレット（CLIENT_ID と CLIENT_SECRET）が揃っているかをチェック。

```typescript
if (hasCtraderCredentials()) {
  // cTrader関連テストを実行
}
```

### `isMinimalTestMode()`

最小限テストモード（コスト最適化モード）かどうかを判定。

```typescript
if (isMinimalTestMode()) {
  // 最小限のテストのみ実行
}
```

### `skipIfMissingSecret(secretName, testName)`

指定したシークレットが未設定の場合にスキップすべきかを判定。

```typescript
if (skipIfMissingSecret('hasAiApiKey', 'AI要約生成テスト')) {
  // スキップ: true が返された
}
```

### `skipIfNotMinimalTest(testName)`

最小限モードの場合に拡張テストをスキップすべきかを判定。

```typescript
if (skipIfNotMinimalTest('複数銘柄の価格取得テスト')) {
  // 最小限モードなのでスキップ
}
```

## テストファイルの実装パターン

### パターン1: 料金が発生するAPI（AI API）

```typescript
import { checkRequiredSecrets, isMinimalTestMode } from './helpers/secret-checker';

const secrets = checkRequiredSecrets();
const minimalMode = isMinimalTestMode();

// API キーが設定されている場合のみテストを実行
const describeOrSkip = secrets.hasAiApiKey ? describe : describe.skip;

describeOrSkip('AI Summary Service - Real API', () => {
  // 最小限のテスト（常に実行）
  test('should generate basic summary', async () => {
    // 1回のAPI呼び出し
    const result = await aiService.generateSummary(simpleData);
    expect(result).toBeDefined();
  });

  // 拡張テスト（フルテストモードのみ）
  const testOrSkip = minimalMode ? test.skip : test;

  testOrSkip('should generate detailed analysis', async () => {
    // 複数のAPI呼び出し
    const result = await aiService.generateDetailedAnalysis(complexData);
    expect(result).toBeDefined();
  });

  testOrSkip('should handle multiple prompts', async () => {
    // さらに複数のAPI呼び出し
    for (const prompt of testPrompts) {
      await aiService.generate(prompt);
    }
  });
});
```

### パターン2: 料金が発生するAPI（Market Data API）

```typescript
import { checkRequiredSecrets, isMinimalTestMode } from './helpers/secret-checker';

const secrets = checkRequiredSecrets();
const minimalMode = isMinimalTestMode();

const describeOrSkip = secrets.hasMarketApiKey ? describe : describe.skip;

describeOrSkip('Market Data Service - Real API', () => {
  // 最小限のテスト（単一銘柄）
  test('should fetch current price for single symbol', async () => {
    const price = await marketService.getPrice('BTCUSD');
    expect(price).toBeGreaterThan(0);
  });

  // 拡張テスト（複数銘柄）
  const testOrSkip = minimalMode ? test.skip : test;

  testOrSkip('should fetch prices for multiple symbols', async () => {
    const symbols = ['BTCUSD', 'ETHUSD', 'XAUUSD', 'USDJPY'];
    const prices = await marketService.getPrices(symbols);
    expect(prices).toHaveLength(4);
  });
});
```

### パターン3: 料金がかからないAPI（cTrader OAuth）

```typescript
import { hasCtraderCredentials } from './helpers/secret-checker';

const canTestCtrader = hasCtraderCredentials();

const describeOrSkip = canTestCtrader ? describe : describe.skip;

describeOrSkip('cTrader Integration - OAuth Flow', () => {
  // 全テスト実行（コスト制限なし）
  test('should authenticate with cTrader', async () => {
    const result = await ctraderAuth.authenticate();
    expect(result.success).toBe(true);
  });

  test('should fetch account information', async () => {
    const account = await ctraderAuth.getAccount();
    expect(account.id).toBeDefined();
  });

  test('should handle token refresh', async () => {
    const newToken = await ctraderAuth.refreshToken();
    expect(newToken).toBeDefined();
  });
});
```

### パターン4: モックを使用したテスト（推奨）

```typescript
// AI APIを実際に呼び出さず、モックを使用
// 料金が発生せず、高速で信頼性が高い

global.fetch = jest.fn();

describe('AI Summary Service - Mocked', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should parse AI response correctly', async () => {
    const mockResponse = {
      choices: [{
        message: { content: 'Test summary' }
      }],
      usage: { total_tokens: 100 }
    };

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const result = await aiService.generateSummary(data);
    expect(result.summary).toBe('Test summary');
  });
});
```

## GitHub Actions でのテスト実行

### 通常実行（最小限モード）

```bash
# Push/PR時に自動実行
# RUN_FULL_PAID_API_TESTS=false（デフォルト）
```

出力例:
```
🔧 Test Environment Setup

Test Mode: 💰 Minimal (Cost Optimized)

✅ AI_API_KEY configured - Running MINIMAL tests (1-2 API calls)
✅ MARKET_API_KEY configured - Running MINIMAL tests (1-2 API calls)
✅ cTrader credentials configured - Running ALL tests (no cost limit)
```

### フルテスト実行（手動）

GitHub Actions の Workflow Dispatch から実行:
1. Actions タブを開く
2. "Tests" ワークフローを選択
3. "Run workflow" をクリック
4. `run_full_tests: true` を選択
5. "Run workflow" を実行

出力例:
```
🔧 Test Environment Setup

Test Mode: 🚀 Full

✅ AI_API_KEY configured - Running FULL tests (multiple API calls)
✅ MARKET_API_KEY configured - Running FULL tests (multiple API calls)
✅ cTrader credentials configured - Running ALL tests (no cost limit)
```

## ローカル環境でのテスト

### .env.test の設定

```bash
# 必須シークレット
TEST_DB_NAME=trader_note_test
TEST_DB_USER=postgres
TEST_DB_PASSWORD=your_password
JWT_SECRET=your_jwt_secret
JWT_REFRESH_SECRET=your_refresh_secret
CRON_SECRET=your_cron_secret
VAPID_PUBLIC_KEY=your_vapid_public_key
VAPID_PRIVATE_KEY=your_vapid_private_key
VAPID_SUBJECT=mailto:your@email.com

# オプショナル（設定すると該当テストが実行される）
AI_API_KEY=your_ai_api_key
MARKET_API_KEY=your_market_api_key
TWELVE_DATA_API_KEY=your_twelve_data_key
CTRADER_CLIENT_ID=your_ctrader_id
CTRADER_CLIENT_SECRET=your_ctrader_secret

# ローカルではフルテストモード（CI=falseなので）
# 最小限モードにしたい場合は以下を設定
# CI=true
# RUN_FULL_PAID_API_TESTS=false
```

### テスト実行

```bash
# 全テスト実行
npm test

# 特定のテストファイルのみ
npm test -- marketIngestService.test.ts

# カバレッジ付き
npm test -- --coverage
```

## ベストプラクティス

### DO ✅

1. **モックを優先**: 可能な限り外部APIをモックしてテストする
2. **最小限のテスト**: 実際のAPI呼び出しは動作確認に必要な最小限のみ
3. **明確なコメント**: 料金が発生するテストには明確なコメントを記載
4. **段階的なテスト**: 基本テスト（最小限）→ 拡張テスト（フル）の順で実装

### DON'T ❌

1. **大量のAPI呼び出し**: ループで複数回API呼び出しするテストは避ける
2. **全テストでリアルAPI**: モックで十分なテストでリアルAPIを使わない
3. **無条件実行**: シークレット未設定時にエラーになるテストを避ける
4. **コスト意識なし**: フルテストモードを頻繁に実行しない

## トラブルシューティング

### テストがスキップされる

```
⚠️  Skipping test "AI要約生成テスト" - Missing secret: hasAiApiKey
```

**原因**: AI_API_KEY が環境変数に設定されていない

**解決方法**:
1. `.env.test` に `AI_API_KEY=your_key` を追加
2. または、モックを使用したテストに変更

### 拡張テストがスキップされる

```
⚠️  Skipping extended test "複数銘柄取得" - Minimal test mode (paid API cost optimization)
```

**原因**: 最小限モードで実行されている

**解決方法**:
1. ローカル環境では自動的にフルモード（CI=false）
2. CI環境でフルテストが必要な場合は手動実行でフラグを有効化

### テストが失敗する

**API キーの確認**:
```bash
# 環境変数を確認
echo $AI_API_KEY
echo $MARKET_API_KEY
```

**API レート制限**:
- フルテストモードで多数のテストを実行すると、APIのレート制限に引っかかる可能性がある
- 最小限モードで実行するか、テスト間に待機時間を追加

## まとめ

- **デフォルト**: 最小限モード（コスト最適化）
- **リリース前**: フルテストモード（手動実行）
- **推奨**: モックを使用したテストを優先
- **実APIテスト**: 動作確認に必要な最小限のみ
