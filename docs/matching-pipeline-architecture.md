# マッチング→通知パイプライン アーキテクチャ

## 概要

Side-A（手動トレードノート）と Side-B（AIトレードノート）の勝ちパターンを
現在のマーケットデータと照合し、類似度が高い瞬間にアプリ内通知を発行するシステム。

## データフロー

```
┌─────────────────────────────────────────────────────────┐
│  Cloud Scheduler (15分間隔)                               │
│  GET /api/cron/matching-pipeline                         │
│  Bearer: CRON_SECRET                                     │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│  MatchingService.runMatchingPipeline()                    │
│                                                          │
│  ┌──────────────┐   ┌──────────────────┐                │
│  │ Side-A        │   │ Side-B            │  ← 並行実行   │
│  │ checkFor      │   │ checkForSideB    │                │
│  │ Matches()     │   │ Matches()        │                │
│  └──────┬───────┘   └────────┬─────────┘                │
│         │                    │                            │
│         │   ┌────────────────┘                            │
│         ▼   ▼                                             │
│  ┌──────────────────┐                                    │
│  │ 統合マッチ結果     │                                    │
│  │ MatchResultDTO[]  │                                    │
│  └────────┬─────────┘                                    │
│           ▼                                               │
│  ┌──────────────────────────┐                            │
│  │ SimultaneousHitControl    │  同時ヒット制御             │
│  │ - シンボル別グループ化     │  - 優先度ソート             │
│  │ - 最大同時通知数制限       │  - スキップログ記録         │
│  └────────┬─────────────────┘                            │
│           ▼                                               │
│  ┌──────────────────────────┐                            │
│  │ NotificationTriggerService│  通知判定                   │
│  │ - スコア閾値 (≥0.75)      │  - 冪等性チェック           │
│  │ - クールダウン (1h)       │  - 24h上限 (30件)          │
│  │ - 重複抑制 (5秒)         │                             │
│  └────────┬─────────────────┘                            │
│           ▼                                               │
│  ┌──────────────────┐                                    │
│  │ NotificationLog   │  DB永続化                          │
│  │ (sent/skipped)    │                                    │
│  └──────────────────┘                                    │
└─────────────────────────────────────────────────────────┘
```

## Side-B マッチングの仕組み

```
┌─────────────────────┐     ┌──────────────────────┐
│ AITradeNote          │     │ AITradePlan           │
│ (outcome='win' 12件) │────▶│ marketAnalysis (JSON) │
│ - symbol: XAU/USD    │     │ - regime: range        │
│ - direction: long    │     │ - volatility: low      │
│ - pnlPips: +197      │     │ - trendDirection       │
│ - rrActual: 1.5      │     │ - keyLevels            │
└─────────┬───────────┘     │ - regimeConfidence     │
          │                  └──────────┬─────────────┘
          │                             │
          ▼                             ▼
┌─────────────────────────────────────────────┐
│ SideBMatchingAdapter                         │
│ - loadWinningNoteEvaluators()                │
│ - Prisma JOIN: AITradeNote + VirtualTrade    │
│   + AITradePlan                               │
└─────────────────┬───────────────────────────┘
                  │ SideBNoteMatchingData
                  ▼
┌─────────────────────────────────────────────┐
│ SideBNoteEvaluator (implements NoteEvaluator)│
│                                              │
│ 条件ベクトル (8次元):                         │
│ [0] trendDirection     ← marketAnalysis       │
│ [1] regimeConfidence   ← marketAnalysis       │
│ [2] volatility         ← marketAnalysis       │
│ [3] directionBias      ← direction            │
│ [4] priceVsSupport     ← keyLevels + entry    │
│ [5] priceVsResistance  ← keyLevels + entry    │
│ [6] rsiZone            ← 中立 (0.5)           │
│ [7] bbPosition         ← regime + direction   │
│                                              │
│ vs.                                          │
│                                              │
│ 現在市場ベクトル (8次元):                     │
│ [0] trendDirection     ← SMA20/SMA50          │
│ [1] regimeConfidence   ← ATR安定度             │
│ [2] volatility         ← BB Width              │
│ [3] directionBias      ← RSI + trend           │
│ [4] priceVsSupport     ← BB Lower距離          │
│ [5] priceVsResistance  ← BB Upper距離          │
│ [6] rsiZone            ← RSI(14)               │
│ [7] bbPosition         ← (close-BBL)/(BBU-BBL) │
│                                              │
│ → コサイン類似度 → 閾値判定 (≥0.75)           │
└─────────────────────────────────────────────┘
```

## APIエンドポイント

| メソッド | パス | 用途 | 認証 |
|---------|------|------|------|
| GET | `/api/cron/matching-pipeline` | 本番用15分cron | CRON_SECRET |
| POST | `/api/cron/matching-pipeline/test` | 手動テスト（休場でも実行可） | CRON_SECRET |

### テストエンドポイントの使い方

```bash
# Side-B のみテスト
curl -X POST https://trader-note-xxx.run.app/api/cron/matching-pipeline/test \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"sideBOnly": true}'

# 全パイプラインテスト
curl -X POST https://trader-note-xxx.run.app/api/cron/matching-pipeline/test \
  -H "Authorization: Bearer $CRON_SECRET"
```

## Cloud Scheduler 設定（GCP）

```bash
gcloud scheduler jobs create http matching-pipeline-15min \
  --project=ai-note-486020 \
  --location=asia-northeast1 \
  --schedule="*/15 * * * *" \
  --uri="https://trader-note-571157808050.asia-northeast1.run.app/api/cron/matching-pipeline" \
  --http-method=GET \
  --headers="Authorization=Bearer $(gcloud secrets versions access latest --secret=CRON_SECRET --project=ai-note-486020)" \
  --time-zone="Asia/Tokyo" \
  --description="マッチングパイプライン（15分間隔）"
```

## 新規ファイル一覧

| ファイル | 責務 |
|---------|------|
| `src/domain/matching/sideBNoteEvaluator.ts` | NoteEvaluator実装。8次元条件ベクトルで照合 |
| `src/services/sideBMatchingAdapter.ts` | DB読込 → SideBNoteEvaluator生成 |

## 変更ファイル一覧

| ファイル | 変更内容 |
|---------|---------|
| `src/services/matchingService.ts` | `checkForSideBMatches()`, `checkForAllMatches()`, `runMatchingPipeline()` 追加 |
| `src/routes/cronRoutes.ts` | `/matching-pipeline` GET + `/matching-pipeline/test` POST 追加 |

## Side-B データ概要（現在）

- **全AITradeNote**: 64件
- **勝ちノート (win)**: 12件 (long: 8, short: 4)
- **シンボル**: XAU/USD のみ
- **マッチング対象**: 勝ちノート12件
