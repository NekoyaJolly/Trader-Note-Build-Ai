# リアルタイム類似度通知アーキテクチャ設計（確定版）

## 1. 前提・目的

本ドキュメントは、**トレードノート × 市場データの類似度を用いたリアルタイム通知機能**について、要件・設計・処理フローを一元的にまとめた確定仕様である。

- バックテストや仮想トレード用途では遅延は問題としない
- 類似度通知のみ **準リアルタイム（5秒以内）** を必須要件とする
- 自動売買は行わない（今後も対象外）

---

## 2. データソース方針

### Side-A（リアルタイム通知）
- **cTrader Open API（WebSocket / Tick）** を使用
- OAuth 2.0 認証（cTrader ID 必須）
- 複数シンボル対応必須

### Side-B（バックテスト / 日次バッチ）
- **Twelve Data REST API（無料枠）** を使用
- 800回/日、8回/分の制限内で運用

### 抽象化レイヤー
- `IMarketDataProvider` インターフェースで統一
- 実装: `TwelveDataProvider`（Side-B）、`CTraderProvider`（Side-A）
- 参照: [src/infrastructure/market/](../src/infrastructure/market/)

---

## 3. 要件（最終確定）

### 機能要件

- 類似度評価時間窓：**60秒（ローリングウィンドウ）**
- 通知上限：**24時間あたり最大30件**（環境変数 `DAILY_NOTIFICATION_LIMIT` で設定可能）
- 市場データ：**OHLCV**
- ローソク足：**アプリ側で正規化した OHLC を描画**

### 非機能要件

- 許容遅延：**最大5秒以内（理想は1〜3秒）**
- 常駐処理：**クラウド（Railway）**
- UI操作：**モバイル完結（Vercel）**
- 金銭コスト：**極小（無料枠中心）**

---

## 4. 全体アーキテクチャ

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          Side-A リアルタイム通知                        │
└─────────────────────────────────────────────────────────────────────────┘

[cTrader Open API (WebSocket/Tick)]
        ↓
[Railway 常駐 Worker]
  ├── CTraderProvider (WebSocket接続)
  │     └── 複数シンボル購読
  ├── RollingWindowService (60秒ウィンドウ)
  │     └── Tick → OHLCV 集約
  ├── IndicatorNormalizationService (正規化)
  │     └── OHLCV + インジケーター正規化
  ├── FeatureVectorService (12次元特徴量)
  │     └── ユーザー定義 + AI 特徴量
  └── NotificationTriggerService (通知判定)
        └── 24h上限30件 + クールダウン
        ↓
[NotificationLog (Prisma)]
        ↓
[WebPushService → モバイル通知]
        ↓
[Vercel UI]
  - モバイル操作
  - 通知表示
  - ローソク足描画

┌─────────────────────────────────────────────────────────────────────────┐
│                          Side-B バックテスト                            │
└─────────────────────────────────────────────────────────────────────────┘

[Twelve Data REST API (無料枠)]
        ↓
[TwelveDataProvider (履歴データ取得)]
        ↓
[日次バッチ / Cron]
```

---

## 5. 市場データ処理仕様

### 5.1 Tick → 60秒ローリングウィンドウ

- 評価範囲：`now - 60s 〜 now`
- Tick受信のたびに再計算（確定足を待たない）

### 5.2 OHLCV 集約ルール

```
open   = window内の最初の価格
high   = window内の最高価格
low    = window内の最安価格
close  = window内の最後の価格
volume = window内の出来高合計
```

- Tick駆動 or 毎秒更新
- 平均遅延は 1〜2 秒

---

## 6. 正規化仕様（共通ロジック）

### 6.1 正規化目的

- 通貨ペア差・価格帯差を排除
- ノートデータと市場データを直接比較可能にする

### 6.2 実装

正規化は `IndicatorNormalizationService` で一元化:
- 参照: [src/services/indicators/indicatorNormalizationService.ts](../src/services/indicators/indicatorNormalizationService.ts)

#### OHLCV 正規化

```typescript
norm_open  = (open  - low) / (high - low)
norm_high  = 1
norm_low   = 0
norm_close = (close - low) / (high - low)
norm_vol   = volume / avg_volume_60s
```

#### インジケーター正規化

| カテゴリ | 正規化方法 | 例 |
|---------|-----------|-----|
| bounded | 線形スケール (0-1) | RSI, Stochastic, Williams %R |
| unbounded | Z-score → tanh (-1〜1) | SMA, EMA, MACD, ATR |

※ ノート側・市場側で **必ず同一ロジックを使用**

---

## 7. 類似度計算仕様

### 7.1 特徴量ベクトル（12次元 + ユーザー定義）

既存の `featureVectorService` が提供する12次元ベクトルを使用:

```
[0-2]  トレンド系: trendDirection, trendStrength, trendAlignment
[3-4]  モメンタム系: macdHistogram, macdCrossover
[5-6]  過熱度系: rsiValue, rsiZone
[7-8]  ボラティリティ系: bbPosition, bbWidth
[9-10] ローソク足構造: candleBody, candleDirection
[11]   時間軸: sessionFlag
```

参照: [src/services/featureVectorService.ts](../src/services/featureVectorService.ts)

ユーザー定義特徴量は `UserIndicatorNoteEvaluator` で対応:
- 参照: [src/domain/noteEvaluator.ts](../src/domain/noteEvaluator.ts)

### 7.2 計算方式

- コサイン類似度（デフォルト）
- ユークリッド距離、マンハッタン距離も選択可能
- 1回あたり計算時間：< 1ms

---

## 8. 通知制御ルール

### 8.1 判定条件

```typescript
if (
  dailyCount < DAILY_NOTIFICATION_LIMIT &&  // 24時間上限30件
  similarity > NOTIFICATION_THRESHOLD &&     // スコア閾値（デフォルト 0.75）
  !isInCooldown &&                           // クールダウン期間外
  !isDuplicate                               // 冪等性チェック
) {
  notify()
}
```

### 8.2 環境変数

| 変数名 | デフォルト | 説明 |
|--------|-----------|------|
| `NOTIFY_THRESHOLD` | 0.75 | 通知スコア閾値 |
| `NOTIFICATION_COOLDOWN_MS` | 3600000 (1時間) | クールダウン期間（ミリ秒） |
| `DAILY_NOTIFICATION_LIMIT` | 30 | 24時間上限件数 |

### 8.3 推奨パラメータ（リアルタイム用）

- 類似度閾値：0.85〜0.92
- クールダウン：120〜300秒（環境変数で設定可能）

参照: [src/services/notification/notificationTriggerService.ts](../src/services/notification/notificationTriggerService.ts)

---

## 9. Railway Worker 実装指針

- HTTPリクエスト前提の設計にしない
- WebSocket 常時接続プロセス
- プロセス再起動時：
  - ローリングウィンドウは破棄して問題なし
  - Tick / OHLC の永続化は不要

---

## 10. データ永続化方針

### 保存する

- トレードノートの特徴量（`TradeNote.features`）
- 通知ログ（`NotificationLog` テーブル）

### 保存しない

- Tick全量
- 秒次・分次OHLC履歴

→ コスト・負荷・実装を最小化

---

## 11. Vercel（UI）の役割

- トレードノート作成・編集
- 正規化済み OHLC の描画（ローソク足）
- 通知の確認・操作

※ 市場取得・類似度判定ロジックは一切持たない

---

## 12. 実装フェーズ

### Phase 1: 共通基盤整備（✅ 完了）

1. ✅ `IMarketDataProvider` 抽象インターフェース作成
2. ✅ `TwelveDataProvider` 実装（Side-B用）
3. ✅ `IndicatorNormalizationService` 実装（正規化統一）
4. ✅ `NotificationTriggerService` に24時間上限追加

### Phase 2: cTrader WebSocket + 常駐Worker（✅ 完了）

1. ✅ `CTraderProvider` 実装（OAuth 2.0 + WebSocket）
2. ✅ `RollingWindowService` 実装（60秒ウィンドウ）
3. ✅ `RealtimeSimilarityService` 実装
4. ✅ `run-realtime-worker.ts` 常駐プロセス
5. ✅ cTrader OAuth 認証フロー（`CTraderAuthService` + API ルート）
6. ✅ フロントエンド Callback ページ（Vercel）

### Phase 3: 統合テスト・本番準備（予定）

1. cTrader OAuth フローの本番動作確認
2. WebSocket 接続の安定性テスト
3. 類似度通知のE2Eテスト
4. Railway 常駐 Worker のデプロイ

---

## 13. ファイル構成

```
src/infrastructure/market/
├── IMarketDataProvider.ts       # 抽象インターフェース
├── TwelveDataProvider.ts        # Side-B用（REST）
├── CTraderProvider.ts           # Side-A用（WebSocket）
└── index.ts                     # エクスポート

src/backend/
├── api/
│   └── ctraderAuthRoutes.ts     # cTrader OAuth API エンドポイント
└── services/
    └── ctrader/
        └── ctraderAuthService.ts # OAuth トークン管理

src/services/
├── indicators/
│   ├── indicatorService.ts              # インジケーター計算
│   └── indicatorNormalizationService.ts # 正規化統一
├── notification/
│   └── notificationTriggerService.ts    # 通知判定（24h上限含む）
└── realtime/
    ├── rollingWindowService.ts          # Tick→OHLCV 集約
    ├── realtimeSimilarityService.ts     # 類似度チェック
    └── index.ts                         # エクスポート

src/frontend/app/auth/ctrader/callback/
└── page.tsx                             # OAuth Callback ページ

scripts/
└── run-realtime-worker.ts               # 常駐ワーカー

prisma/schema.prisma
└── CTraderToken                         # OAuth トークン保存
```

---

## 14. cTrader OAuth フロー

```
┌──────────────────────────────────────────────────────────────────┐
│                    cTrader OAuth 認証フロー                       │
└──────────────────────────────────────────────────────────────────┘

[1] ユーザー
    │
    ├─→ 設定画面「cTrader連携」ボタン
    │
[2] ↓
    │
[3] GET /api/auth/ctrader/url
    │   → 認証URL を取得
    │
[4] ↓
    │
[5] cTrader ログイン画面（外部）
    │   → ユーザーが認証・許可
    │
[6] ↓
    │
[7] Redirect: /auth/ctrader/callback?code=xxx
    │   → Vercel Callback ページ
    │
[8] ↓
    │
[9] POST /api/auth/ctrader/exchange { code }
    │   → Railway Backend
    │   → cTrader Token API で code → token 交換
    │   → CTraderToken テーブルに保存
    │
[10] ↓
    │
[11] Redirect: /settings?ctrader=connected
    │
[12] 完了
```

---

## 14. 本設計の評価

- リアルタイム性：◎（1〜3秒）
- モバイル完結：◎
- 無料運用：◎
- 拡張性：◎
- 設計一貫性：◎

---


