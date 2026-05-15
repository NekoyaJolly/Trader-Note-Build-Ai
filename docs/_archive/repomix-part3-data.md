This file is a merged representation of a subset of the codebase, containing specifically included files, combined into a single document by Repomix.

<file_summary>
This section contains a summary of this file.

<purpose>
This file contains a packed representation of a subset of the repository's contents that is considered the most important context.
It is designed to be easily consumable by AI systems for analysis, code review,
or other automated processes.
</purpose>

<file_format>
The content is organized as follows:
1. This summary section
2. Repository information
3. Directory structure
4. Repository files (if enabled)
5. Multiple file entries, each consisting of:
  - File path as an attribute
  - Full contents of the file
</file_format>

<usage_guidelines>
- This file should be treated as read-only. Any changes should be made to the
  original repository files, not this packed version.
- When processing this file, use the file path to distinguish
  between different files in the repository.
- Be aware that this file may contain sensitive information. Handle it with
  the same level of security as you would the original repository.
</usage_guidelines>

<notes>
- Some files may have been excluded based on .gitignore rules and Repomix's configuration
- Binary files are not included in this packed representation. Please refer to the Repository Structure section for a complete list of file paths, including binary files
- Only files matching these patterns are included: prisma/**/*, data/**/*
- Files matching patterns in .gitignore are excluded
- Files matching default ignore patterns are excluded
- Files are sorted by Git change count (files with more changes are at the bottom)
</notes>

</file_summary>

<directory_structure>
data/evolution/.gitkeep
data/indicator-settings.json
data/trades/README.md
data/trades/sample_trades.csv
data/user-settings.json
prisma/dev.db
prisma/migrations/20251226140839_init/migration.sql
prisma/migrations/20251226145845_phase3_match_reasons/migration.sql
prisma/migrations/20251227001002_phase4_notification_log/migration.sql
prisma/migrations/20251229144407_phase12b_timeseries_data/migration.sql
prisma/migrations/20251230203821_add_note_status_backtest_push/migration.sql
prisma/migrations/20260101015955_add_strategy_models/migration.sql
prisma/migrations/20260101040216_add_strategy_note_phase_c_fields/migration.sql
prisma/migrations/20260101055354_add_phase_d_alert_walkforward/migration.sql
prisma/migrations/20260101064043_add_user_and_watchlist/migration.sql
prisma/migrations/20260101212035_add_note_indicator_config/migration.sql
prisma/migrations/20260101225331_add_evaluation_log/migration.sql
prisma/migrations/20260101233137_add_phase8_note_priority_batch_config/migration.sql
prisma/migrations/20260102164903_rename_note_status_active_archived/migration.sql
prisma/migrations/20260102181629_add_data_preset_model/migration.sql
prisma/migrations/20260103154346_add_source_to_backtest_and_montecarlo_history/migration.sql
prisma/migrations/20260103215649_add_side_b_tables/migration.sql
prisma/migrations/20260103225427_simplify_market_research/migration.sql
prisma/migrations/20260104011447_add_virtual_portfolio/migration.sql
prisma/migrations/20260104215436_add_ai_trade_note/migration.sql
prisma/migrations/20260105231808_add_ctrader_token/migration.sql
prisma/migrations/20260108143748_add_tick_and_realtime_ohlcv/migration.sql
prisma/migrations/20260114050906_ctrader_only_auth/migration.sql
prisma/migrations/20260215205536_init/migration.sql
prisma/migrations/20260409120000_add_chart_drawing/migration.sql
prisma/migrations/20260409140000_enable_rls_all_tables/migration.sql
prisma/migrations/20260417000000_add_ai_trade_note_lens_snapshot/migration.sql
prisma/migrations/20260418000000_add_edge_hypothesis/migration.sql
prisma/migrations/20260418120000_add_phase_4b_bridge_fields/migration.sql
prisma/migrations/20260418180000_add_screening_result/migration.sql
prisma/migrations/20260419000000_add_phase_4c_validation_report/migration.sql
prisma/migrations/20260422000000_add_phase_6_prompt_registry/migration.sql
prisma/migrations/20260422010000_enable_rls_phase_6_tables/migration.sql
prisma/migrations/20260425134500_add_spread_bar/migration.sql
prisma/migrations/20260503010000_add_screening_backtest_run/migration.sql
prisma/migrations/20260503020000_drop_legacy_backtest_tables/migration.sql
prisma/migrations/20260503030000_add_evolution_backtest_run/migration.sql
prisma/migrations/20260509000000_phase_b1_evolution_bt_trades/migration.sql
prisma/migrations/20260509010000_phase_b2_evolution_carry/migration.sql
prisma/migrations/20260509020000_phase_d1a_generation_lesson/migration.sql
prisma/migrations/migration_lock.toml
prisma/schema.prisma
</directory_structure>

<files>
This section contains the contents of the repository's files.

<file path="data/evolution/.gitkeep">

</file>

<file path="data/indicator-settings.json">
{
  "activeSet": {
    "name": "デフォルト",
    "configs": [
      {
        "configId": "rsi-14",
        "indicatorId": "rsi",
        "label": "RSI(14)",
        "params": {
          "period": 14
        },
        "enabled": true
      },
      {
        "configId": "sma-20",
        "indicatorId": "sma",
        "label": "SMA(20)",
        "params": {
          "period": 20
        },
        "enabled": true
      },
      {
        "configId": "ema-period18",
        "indicatorId": "ema",
        "label": "EMA(18)",
        "params": {
          "period": 18
        },
        "enabled": true
      },
      {
        "configId": "macd-default",
        "indicatorId": "macd",
        "label": "MACD",
        "params": {
          "fastPeriod": 12,
          "slowPeriod": 26,
          "signalPeriod": 9
        },
        "enabled": true
      },
      {
        "configId": "bb-20",
        "indicatorId": "bb",
        "label": "BB(20)",
        "params": {
          "period": 20
        },
        "enabled": true
      },
      {
        "configId": "atr-14",
        "indicatorId": "atr",
        "label": "ATR(14)",
        "params": {
          "period": 14
        },
        "enabled": true
      },
      {
        "configId": "stoch-14-3",
        "indicatorId": "stochastic",
        "label": "Stoch(14,3)",
        "params": {
          "kPeriod": 14,
          "dPeriod": 3
        },
        "enabled": true
      },
      {
        "configId": "obv-default",
        "indicatorId": "obv",
        "label": "OBV",
        "params": {},
        "enabled": true
      },
      {
        "configId": "vwap-default",
        "indicatorId": "vwap",
        "label": "VWAP",
        "params": {},
        "enabled": true
      },
      {
        "configId": "williamsR-period21",
        "indicatorId": "williamsR",
        "label": "WILLIAMSR(21)",
        "params": {
          "period": 21
        },
        "enabled": true
      },
      {
        "configId": "cmf-period20",
        "indicatorId": "cmf",
        "label": "CMF(20)",
        "params": {
          "period": 20
        },
        "enabled": true
      }
    ],
    "createdAt": "2025-12-30T18:47:34.801Z",
    "updatedAt": "2025-12-31T00:46:52.718Z"
  },
  "updatedAt": "2025-12-31T00:46:52.718Z",
  "hasCompletedSetup": true
}
</file>

<file path="data/trades/README.md">
# テスト用CSVファイル一覧

このディレクトリには、TradeAssist のテストと検証用のCSVファイルが含まれています。

## 必須カラム

```csv
timestamp,symbol,side,price,quantity
```

オプションカラム: `fee`, `exchange`

## ファイル一覧

### 基本テスト用

| ファイル | 件数 | 用途 |
|----------|------|------|
| `sample_trades.csv` | 5 | 基本動作確認（BTC, ETH） |
| `test_trades_recent.csv` | 10 | 最新市場価格テスト（2024年12月） |
| `test_trades_multi.csv` | 15 | 大量データ・複数取引所テスト |
| `test_trades_minimal.csv` | 3 | 必須フィールドのみ |
| `test_trades_invalid.csv` | 7 | 異常系・バリデーションテスト |

### 追加テスト用

| ファイル | 用途 |
|----------|------|
| `test.csv` | 汎用テスト |
| `test_import.csv` | インポート処理テスト |
| `test_import4.csv` | インポート処理テスト（パターン4） |
| `test_import5.csv` | インポート処理テスト（パターン5） |
| `crash_test.csv` | クラッシュ耐性テスト |
| `final_test.csv` | 最終検証テスト |

## 使用例

### CLI からインポート

```bash
# スクリプト経由
npx ts-node scripts/import-trades.ts data/trades/sample_trades.csv
```

### API 経由

```bash
# ファイル名指定（サーバー上のファイル）
curl -X POST http://localhost:3100/api/trades/import/csv \
  -H "Content-Type: application/json" \
  -d '{"filename": "sample_trades.csv"}'

# CSV テキスト直接送信
curl -X POST http://localhost:3100/api/trades/import/upload-text \
  -H "Content-Type: application/json" \
  -d '{"filename": "my_trades.csv", "csvText": "timestamp,symbol,side,price,quantity\n2024-01-15T10:30:00Z,BTCUSDT,buy,42500.00,0.1"}'
```

### UI からインポート

1. ブラウザで http://localhost:3102/import を開く
2. CSV ファイルを選択してアップロード
3. 生成されるノートの内容と件数を確認

## 期待される結果

| CSV | 取り込み | スキップ | ノート生成 |
|-----|---------|---------|-----------|
| sample_trades.csv | 5 | 0 | 5 |
| test_trades_recent.csv | 10 | 0 | 10 |
| test_trades_multi.csv | 15 | 0 | 15 |
| test_trades_minimal.csv | 3 | 0 | 3 |
| test_trades_invalid.csv | 0-1 | 6-7 | 0-1 |

## 異常系テストの詳細

`test_trades_invalid.csv` に含まれるエラーパターン:

- 極小値（0.00001）
- 不正な symbol 形式
- 不正な side（`invalid_side`）
- 負の価格・数量
- 不正な timestamp 形式
- 数値でない quantity

これらはエラーログが出力されることが正常です。

## 注意事項

- 実際の本番環境では、ユーザーが各ブローカーからエクスポートした実データを使用
- CSV フォーマットは MT4/MT5 の標準的な出力形式に準拠
- タイムスタンプは UTC (ISO 8601 形式) を推奨
</file>

<file path="data/trades/sample_trades.csv">
timestamp,symbol,side,price,quantity,fee,exchange
2024-01-15T10:30:00Z,BTCUSDT,buy,42500.00,0.1,4.25,Binance
2024-01-15T14:45:00Z,BTCUSDT,sell,43000.00,0.1,4.30,Binance
2024-01-16T09:20:00Z,ETHUSDT,buy,2250.00,1.0,2.25,Binance
2024-01-16T16:30:00Z,ETHUSDT,sell,2300.00,1.0,2.30,Binance
2024-01-17T11:00:00Z,BTCUSDT,buy,41800.00,0.15,6.27,Binance
</file>

<file path="data/user-settings.json">
{
  "notification": {
    "enabled": true,
    "scoreThreshold": 80,
    "maxPerDay": 15
  },
  "timeframes": {
    "primary": "1h",
    "secondary": [
      "4h",
      "1d"
    ]
  },
  "display": {
    "darkMode": true,
    "compactView": false,
    "showAiSuggestions": true
  },
  "updatedAt": "2026-01-02T16:35:46.747Z"
}
</file>

<file path="prisma/dev.db">

</file>

<file path="prisma/migrations/20251226140839_init/migration.sql">
-- CreateEnum
CREATE TYPE "TradeSide" AS ENUM ('buy', 'sell');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('unread', 'read', 'deleted');

-- CreateTable
CREATE TABLE "Trade" (
    "id" UUID NOT NULL,
    "timestamp" TIMESTAMPTZ(6) NOT NULL,
    "symbol" TEXT NOT NULL,
    "side" "TradeSide" NOT NULL,
    "price" DECIMAL(18,8) NOT NULL,
    "quantity" DECIMAL(18,8) NOT NULL,
    "fee" DECIMAL(18,8),
    "exchange" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeNote" (
    "id" UUID NOT NULL,
    "tradeId" UUID NOT NULL,
    "symbol" TEXT NOT NULL,
    "entryPrice" DECIMAL(18,8) NOT NULL,
    "side" "TradeSide" NOT NULL,
    "indicators" JSONB,
    "featureVector" DOUBLE PRECISION[],
    "timeframe" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "TradeNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AISummary" (
    "id" UUID NOT NULL,
    "noteId" UUID NOT NULL,
    "summary" TEXT NOT NULL,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "model" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AISummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketSnapshot" (
    "id" UUID NOT NULL,
    "symbol" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "close" DECIMAL(18,8) NOT NULL,
    "volume" DECIMAL(18,8) NOT NULL,
    "indicators" JSONB NOT NULL,
    "fetchedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchResult" (
    "id" UUID NOT NULL,
    "noteId" UUID NOT NULL,
    "marketSnapshotId" UUID NOT NULL,
    "symbol" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "trendMatched" BOOLEAN NOT NULL,
    "priceRangeMatched" BOOLEAN NOT NULL,
    "decidedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "matchResultId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'unread',
    "sentAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderPreset" (
    "id" UUID NOT NULL,
    "matchResultId" UUID NOT NULL,
    "symbol" TEXT NOT NULL,
    "side" "TradeSide" NOT NULL,
    "suggestedPrice" DECIMAL(18,8) NOT NULL,
    "suggestedQuantity" DECIMAL(18,8) NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "feesEstimate" DECIMAL(18,8),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderPreset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_trade_symbol_timestamp" ON "Trade"("symbol", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "TradeNote_tradeId_key" ON "TradeNote"("tradeId");

-- CreateIndex
CREATE INDEX "idx_tradenote_symbol" ON "TradeNote"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "AISummary_noteId_key" ON "AISummary"("noteId");

-- CreateIndex
CREATE INDEX "idx_snapshot_symbol_timeframe" ON "MarketSnapshot"("symbol", "timeframe");

-- CreateIndex
CREATE UNIQUE INDEX "uq_snapshot_symbol_timeframe_fetched" ON "MarketSnapshot"("symbol", "timeframe", "fetchedAt");

-- CreateIndex
CREATE INDEX "idx_match_symbol_decided" ON "MatchResult"("symbol", "decidedAt");

-- CreateIndex
CREATE UNIQUE INDEX "uq_match_note_snapshot" ON "MatchResult"("noteId", "marketSnapshotId");

-- CreateIndex
CREATE INDEX "idx_notification_status_sent" ON "Notification"("status", "sentAt");

-- CreateIndex
CREATE INDEX "idx_orderpreset_symbol_created" ON "OrderPreset"("symbol", "createdAt");

-- AddForeignKey
ALTER TABLE "TradeNote" ADD CONSTRAINT "TradeNote_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AISummary" ADD CONSTRAINT "AISummary_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "TradeNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchResult" ADD CONSTRAINT "MatchResult_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "TradeNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchResult" ADD CONSTRAINT "MatchResult_marketSnapshotId_fkey" FOREIGN KEY ("marketSnapshotId") REFERENCES "MarketSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_matchResultId_fkey" FOREIGN KEY ("matchResultId") REFERENCES "MatchResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderPreset" ADD CONSTRAINT "OrderPreset_matchResultId_fkey" FOREIGN KEY ("matchResultId") REFERENCES "MatchResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
</file>

<file path="prisma/migrations/20251226145845_phase3_match_reasons/migration.sql">
/*
  Warnings:

  - Added the required column `reasons` to the `MatchResult` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "MatchResult" ADD COLUMN     "evaluatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "reasons" JSONB NOT NULL;
</file>

<file path="prisma/migrations/20251227001002_phase4_notification_log/migration.sql">
-- Phase4: 通知ログテーブルを追加
-- 目的: 再通知防止（冪等性・クールダウン）と配信履歴の永続化

-- NotificationLogStatus 列挙型を追加
CREATE TYPE "NotificationLogStatus" AS ENUM ('sent', 'skipped', 'failed');

-- NotificationLog テーブルを作成
CREATE TABLE "NotificationLog" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "noteId" UUID NOT NULL,
    "marketSnapshotId" UUID NOT NULL,
    "symbol" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "channel" TEXT NOT NULL,
    "status" "NotificationLogStatus" NOT NULL DEFAULT 'sent',
    "reasonSummary" TEXT NOT NULL,
    "sentAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- 外部キー制約を追加
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "TradeNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_marketSnapshotId_fkey" FOREIGN KEY ("marketSnapshotId") REFERENCES "MarketSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ユニーク制約を追加（冪等性保証）
CREATE UNIQUE INDEX "uq_notiflog_note_snapshot_channel" ON "NotificationLog"("noteId", "marketSnapshotId", "channel");

-- インデックスを追加
CREATE INDEX "idx_notiflog_symbol_sent" ON "NotificationLog"("symbol", "sentAt");
CREATE INDEX "idx_notiflog_note_sent" ON "NotificationLog"("noteId", "sentAt");
</file>

<file path="prisma/migrations/20251229144407_phase12b_timeseries_data/migration.sql">
-- CreateEnum
CREATE TYPE "RevaluationJobType" AS ENUM ('note_regenerate', 'feature_recalculate', 'ai_summary_regenerate', 'full_reprocess');

-- CreateEnum
CREATE TYPE "RevaluationJobStatus" AS ENUM ('pending', 'running', 'completed', 'failed', 'cancelled');

-- CreateTable
CREATE TABLE "OHLCVCandle" (
    "id" UUID NOT NULL,
    "symbol" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "timestamp" TIMESTAMPTZ(6) NOT NULL,
    "open" DECIMAL(18,8) NOT NULL,
    "high" DECIMAL(18,8) NOT NULL,
    "low" DECIMAL(18,8) NOT NULL,
    "close" DECIMAL(18,8) NOT NULL,
    "volume" DECIMAL(18,8) NOT NULL,
    "source" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OHLCVCandle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeNoteRaw" (
    "id" UUID NOT NULL,
    "noteId" UUID NOT NULL,
    "rawData" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "TradeNoteRaw_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevaluationJob" (
    "id" UUID NOT NULL,
    "jobType" "RevaluationJobType" NOT NULL,
    "targetNoteId" UUID,
    "targetSymbol" TEXT,
    "status" "RevaluationJobStatus" NOT NULL DEFAULT 'pending',
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMPTZ(6),
    "completedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "RevaluationJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_ohlcv_symbol_timeframe_timestamp" ON "OHLCVCandle"("symbol", "timeframe", "timestamp");

-- CreateIndex
CREATE INDEX "idx_ohlcv_symbol_timestamp" ON "OHLCVCandle"("symbol", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "uq_ohlcv_symbol_timeframe_timestamp" ON "OHLCVCandle"("symbol", "timeframe", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "TradeNoteRaw_noteId_key" ON "TradeNoteRaw"("noteId");

-- CreateIndex
CREATE INDEX "idx_tradenoteraw_noteid" ON "TradeNoteRaw"("noteId");

-- CreateIndex
CREATE INDEX "idx_revaluationjob_status_created" ON "RevaluationJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "idx_revaluationjob_type_status" ON "RevaluationJob"("jobType", "status");
</file>

<file path="prisma/migrations/20251230203821_add_note_status_backtest_push/migration.sql">
-- CreateEnum
CREATE TYPE "NoteStatus" AS ENUM ('draft', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "BacktestStatus" AS ENUM ('pending', 'running', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "BacktestOutcome" AS ENUM ('win', 'loss', 'timeout');

-- CreateEnum
CREATE TYPE "PushLogStatus" AS ENUM ('pending', 'sent', 'failed', 'retrying');

-- AlterTable
ALTER TABLE "TradeNote" ADD COLUMN     "approvedAt" TIMESTAMPTZ(6),
ADD COLUMN     "lastEditedAt" TIMESTAMPTZ(6),
ADD COLUMN     "marketContext" JSONB,
ADD COLUMN     "rejectedAt" TIMESTAMPTZ(6),
ADD COLUMN     "status" "NoteStatus" NOT NULL DEFAULT 'draft',
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "userNotes" TEXT;

-- CreateTable
CREATE TABLE "BacktestRun" (
    "id" UUID NOT NULL,
    "noteId" UUID NOT NULL,
    "symbol" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "startDate" TIMESTAMPTZ(6) NOT NULL,
    "endDate" TIMESTAMPTZ(6) NOT NULL,
    "matchThreshold" DOUBLE PRECISION NOT NULL,
    "takeProfit" DECIMAL(18,8) NOT NULL,
    "stopLoss" DECIMAL(18,8) NOT NULL,
    "maxHoldingMinutes" INTEGER NOT NULL DEFAULT 1440,
    "tradingCost" DECIMAL(18,8),
    "status" "BacktestStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "BacktestRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BacktestResult" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "setupCount" INTEGER NOT NULL,
    "winCount" INTEGER NOT NULL,
    "lossCount" INTEGER NOT NULL,
    "timeoutCount" INTEGER NOT NULL,
    "winRate" DOUBLE PRECISION NOT NULL,
    "profitFactor" DOUBLE PRECISION,
    "totalProfit" DECIMAL(18,8) NOT NULL,
    "totalLoss" DECIMAL(18,8) NOT NULL,
    "averagePnL" DECIMAL(18,8) NOT NULL,
    "expectancy" DECIMAL(18,8) NOT NULL,
    "maxDrawdown" DECIMAL(18,8),
    "completedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BacktestResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BacktestEvent" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "entryTime" TIMESTAMPTZ(6) NOT NULL,
    "entryPrice" DECIMAL(18,8) NOT NULL,
    "matchScore" DOUBLE PRECISION NOT NULL,
    "exitTime" TIMESTAMPTZ(6),
    "exitPrice" DECIMAL(18,8),
    "outcome" "BacktestOutcome" NOT NULL,
    "pnl" DECIMAL(18,8),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BacktestEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL DEFAULT 'default',
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastPushedAt" TIMESTAMPTZ(6),
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushLog" (
    "id" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "notificationId" UUID,
    "status" "PushLogStatus" NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchDetail" (
    "id" UUID NOT NULL,
    "matchResultId" UUID NOT NULL,
    "featureName" TEXT NOT NULL,
    "noteValue" DOUBLE PRECISION,
    "snapshotValue" DOUBLE PRECISION,
    "similarity" DOUBLE PRECISION NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "contribution" DOUBLE PRECISION NOT NULL,
    "isAnomaly" BOOLEAN NOT NULL DEFAULT false,
    "anomalyDetail" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchDetail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_backtestrun_noteid" ON "BacktestRun"("noteId");

-- CreateIndex
CREATE INDEX "idx_backtestrun_status_created" ON "BacktestRun"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BacktestResult_runId_key" ON "BacktestResult"("runId");

-- CreateIndex
CREATE INDEX "idx_backtestevent_run_entry" ON "BacktestEvent"("runId", "entryTime");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "idx_pushsub_user_active" ON "PushSubscription"("userId", "active");

-- CreateIndex
CREATE INDEX "idx_pushlog_sub_created" ON "PushLog"("subscriptionId", "createdAt");

-- CreateIndex
CREATE INDEX "idx_pushlog_status_created" ON "PushLog"("status", "createdAt");

-- CreateIndex
CREATE INDEX "idx_matchdetail_matchresult" ON "MatchDetail"("matchResultId");

-- CreateIndex
CREATE INDEX "idx_tradenote_status" ON "TradeNote"("status");

-- CreateIndex
CREATE INDEX "idx_tradenote_symbol_status" ON "TradeNote"("symbol", "status");

-- AddForeignKey
ALTER TABLE "BacktestRun" ADD CONSTRAINT "BacktestRun_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "TradeNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BacktestResult" ADD CONSTRAINT "BacktestResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "BacktestRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BacktestEvent" ADD CONSTRAINT "BacktestEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "BacktestRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
</file>

<file path="prisma/migrations/20260101015955_add_strategy_models/migration.sql">
-- CreateEnum
CREATE TYPE "StrategyStatus" AS ENUM ('draft', 'active', 'archived');

-- CreateTable
CREATE TABLE "Strategy" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "symbol" TEXT NOT NULL,
    "side" "TradeSide" NOT NULL,
    "status" "StrategyStatus" NOT NULL DEFAULT 'draft',
    "currentVersionId" UUID,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Strategy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyVersion" (
    "id" UUID NOT NULL,
    "strategyId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "entryConditions" JSONB NOT NULL,
    "exitSettings" JSONB NOT NULL,
    "entryTiming" TEXT NOT NULL DEFAULT 'next_open',
    "changeNote" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrategyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyNote" (
    "id" UUID NOT NULL,
    "strategyId" UUID NOT NULL,
    "entryTime" TIMESTAMPTZ(6) NOT NULL,
    "entryPrice" DECIMAL(18,8) NOT NULL,
    "conditionSnapshot" JSONB NOT NULL,
    "indicatorValues" JSONB NOT NULL,
    "outcome" "BacktestOutcome" NOT NULL,
    "pnl" DECIMAL(18,8),
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrategyNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyBacktestRun" (
    "id" UUID NOT NULL,
    "strategyId" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "symbol" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "startDate" TIMESTAMPTZ(6) NOT NULL,
    "endDate" TIMESTAMPTZ(6) NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'stage1',
    "status" "BacktestStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "StrategyBacktestRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyBacktestResult" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "setupCount" INTEGER NOT NULL,
    "winCount" INTEGER NOT NULL,
    "lossCount" INTEGER NOT NULL,
    "timeoutCount" INTEGER NOT NULL,
    "winRate" DOUBLE PRECISION NOT NULL,
    "profitFactor" DOUBLE PRECISION,
    "totalProfit" DECIMAL(18,8) NOT NULL,
    "totalLoss" DECIMAL(18,8) NOT NULL,
    "averagePnL" DECIMAL(18,8) NOT NULL,
    "expectancy" DECIMAL(18,8) NOT NULL,
    "maxDrawdown" DECIMAL(18,8),
    "completedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrategyBacktestResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyBacktestEvent" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "entryTime" TIMESTAMPTZ(6) NOT NULL,
    "entryPrice" DECIMAL(18,8) NOT NULL,
    "indicatorValues" JSONB,
    "exitTime" TIMESTAMPTZ(6),
    "exitPrice" DECIMAL(18,8),
    "outcome" "BacktestOutcome" NOT NULL,
    "pnl" DECIMAL(18,8),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrategyBacktestEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_strategy_symbol" ON "Strategy"("symbol");

-- CreateIndex
CREATE INDEX "idx_strategy_status" ON "Strategy"("status");

-- CreateIndex
CREATE INDEX "idx_strategy_symbol_status" ON "Strategy"("symbol", "status");

-- CreateIndex
CREATE INDEX "idx_strategyversion_strategyid" ON "StrategyVersion"("strategyId");

-- CreateIndex
CREATE UNIQUE INDEX "uq_strategyversion_strategy_version" ON "StrategyVersion"("strategyId", "versionNumber");

-- CreateIndex
CREATE INDEX "idx_strategynote_strategyid" ON "StrategyNote"("strategyId");

-- CreateIndex
CREATE INDEX "idx_strategynote_strategy_outcome" ON "StrategyNote"("strategyId", "outcome");

-- CreateIndex
CREATE INDEX "idx_strategybacktestrun_strategyid" ON "StrategyBacktestRun"("strategyId");

-- CreateIndex
CREATE INDEX "idx_strategybacktestrun_status_created" ON "StrategyBacktestRun"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StrategyBacktestResult_runId_key" ON "StrategyBacktestResult"("runId");

-- CreateIndex
CREATE INDEX "idx_strategybacktestevent_run_entry" ON "StrategyBacktestEvent"("runId", "entryTime");

-- AddForeignKey
ALTER TABLE "StrategyVersion" ADD CONSTRAINT "StrategyVersion_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyNote" ADD CONSTRAINT "StrategyNote_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyBacktestRun" ADD CONSTRAINT "StrategyBacktestRun_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyBacktestResult" ADD CONSTRAINT "StrategyBacktestResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StrategyBacktestRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyBacktestEvent" ADD CONSTRAINT "StrategyBacktestEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StrategyBacktestRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
</file>

<file path="prisma/migrations/20260101040216_add_strategy_note_phase_c_fields/migration.sql">
/*
  Warnings:

  - Added the required column `updatedAt` to the `StrategyNote` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "StrategyNoteStatus" AS ENUM ('draft', 'active', 'archived');

-- AlterTable
ALTER TABLE "StrategyNote" ADD COLUMN     "featureVector" DOUBLE PRECISION[] DEFAULT ARRAY[]::DOUBLE PRECISION[],
ADD COLUMN     "status" "StrategyNoteStatus" NOT NULL DEFAULT 'draft',
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "updatedAt" TIMESTAMPTZ(6) NOT NULL;

-- CreateIndex
CREATE INDEX "idx_strategynote_status" ON "StrategyNote"("status");

-- CreateIndex
CREATE INDEX "idx_strategynote_strategy_status" ON "StrategyNote"("strategyId", "status");
</file>

<file path="prisma/migrations/20260101055354_add_phase_d_alert_walkforward/migration.sql">
-- CreateEnum
CREATE TYPE "AlertChannel" AS ENUM ('in_app', 'web_push');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('enabled', 'disabled', 'paused');

-- CreateEnum
CREATE TYPE "WalkForwardType" AS ENUM ('fixed_split', 'rolling_window');

-- CreateTable
CREATE TABLE "StrategyAlert" (
    "id" UUID NOT NULL,
    "strategyId" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" "AlertStatus" NOT NULL DEFAULT 'enabled',
    "cooldownMinutes" INTEGER NOT NULL DEFAULT 60,
    "channels" "AlertChannel"[] DEFAULT ARRAY['in_app']::"AlertChannel"[],
    "minMatchScore" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "lastTriggeredAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "StrategyAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyAlertLog" (
    "id" UUID NOT NULL,
    "alertId" UUID NOT NULL,
    "matchScore" DOUBLE PRECISION NOT NULL,
    "indicatorValues" JSONB NOT NULL,
    "channel" "AlertChannel" NOT NULL,
    "success" BOOLEAN NOT NULL,
    "errorMessage" TEXT,
    "triggeredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrategyAlertLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalkForwardRun" (
    "id" UUID NOT NULL,
    "strategyId" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "type" "WalkForwardType" NOT NULL DEFAULT 'fixed_split',
    "splitCount" INTEGER NOT NULL DEFAULT 4,
    "inSampleDays" INTEGER NOT NULL,
    "outOfSampleDays" INTEGER NOT NULL,
    "startDate" TIMESTAMPTZ(6) NOT NULL,
    "endDate" TIMESTAMPTZ(6) NOT NULL,
    "timeframe" TEXT NOT NULL DEFAULT '1h',
    "status" "BacktestStatus" NOT NULL DEFAULT 'pending',
    "overfitScore" DOUBLE PRECISION,
    "overfitWarning" BOOLEAN,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "WalkForwardRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalkForwardSplit" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "splitNumber" INTEGER NOT NULL,
    "inSampleStart" TIMESTAMPTZ(6) NOT NULL,
    "inSampleEnd" TIMESTAMPTZ(6) NOT NULL,
    "outOfSampleStart" TIMESTAMPTZ(6) NOT NULL,
    "outOfSampleEnd" TIMESTAMPTZ(6) NOT NULL,
    "inSampleWinRate" DOUBLE PRECISION NOT NULL,
    "inSampleTradeCount" INTEGER NOT NULL,
    "inSampleProfitFactor" DOUBLE PRECISION,
    "outOfSampleWinRate" DOUBLE PRECISION NOT NULL,
    "outOfSampleTradeCount" INTEGER NOT NULL,
    "outOfSampleProfitFactor" DOUBLE PRECISION,
    "winRateDiff" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalkForwardSplit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StrategyAlert_strategyId_key" ON "StrategyAlert"("strategyId");

-- CreateIndex
CREATE INDEX "idx_strategyalert_enabled_status" ON "StrategyAlert"("enabled", "status");

-- CreateIndex
CREATE INDEX "idx_strategyalertlog_alert_triggered" ON "StrategyAlertLog"("alertId", "triggeredAt");

-- CreateIndex
CREATE INDEX "idx_walkforwardrun_strategyid" ON "WalkForwardRun"("strategyId");

-- CreateIndex
CREATE INDEX "idx_walkforwardrun_status_created" ON "WalkForwardRun"("status", "createdAt");

-- CreateIndex
CREATE INDEX "idx_walkforwardsplit_runid" ON "WalkForwardSplit"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "uq_walkforwardsplit_run_number" ON "WalkForwardSplit"("runId", "splitNumber");

-- AddForeignKey
ALTER TABLE "StrategyAlert" ADD CONSTRAINT "StrategyAlert_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyAlertLog" ADD CONSTRAINT "StrategyAlertLog_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "StrategyAlert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalkForwardRun" ADD CONSTRAINT "WalkForwardRun_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalkForwardSplit" ADD CONSTRAINT "WalkForwardSplit_runId_fkey" FOREIGN KEY ("runId") REFERENCES "WalkForwardRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
</file>

<file path="prisma/migrations/20260101064043_add_user_and_watchlist/migration.sql">
/*
  Warnings:

  - Changed the type of `userId` on the `PushSubscription` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('user', 'admin');

-- AlterTable
ALTER TABLE "PushSubscription" DROP COLUMN "userId",
ADD COLUMN     "userId" UUID NOT NULL;

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'user',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "refreshToken" TEXT,
    "lastLoginAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Watchlist" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "symbol" TEXT NOT NULL,
    "timeframes" TEXT[] DEFAULT ARRAY['15m', '1h']::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Watchlist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "idx_user_email" ON "User"("email");

-- CreateIndex
CREATE INDEX "idx_user_active" ON "User"("active");

-- CreateIndex
CREATE INDEX "idx_watchlist_user_active" ON "Watchlist"("userId", "active");

-- CreateIndex
CREATE INDEX "idx_watchlist_active" ON "Watchlist"("active");

-- CreateIndex
CREATE UNIQUE INDEX "uq_watchlist_user_symbol" ON "Watchlist"("userId", "symbol");

-- CreateIndex
CREATE INDEX "idx_pushsub_user_active" ON "PushSubscription"("userId", "active");

-- AddForeignKey
ALTER TABLE "Watchlist" ADD CONSTRAINT "Watchlist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
</file>

<file path="prisma/migrations/20260101212035_add_note_indicator_config/migration.sql">
-- AlterTable
ALTER TABLE "TradeNote" ADD COLUMN     "indicatorConfig" JSONB;
</file>

<file path="prisma/migrations/20260101225331_add_evaluation_log/migration.sql">
-- CreateTable
CREATE TABLE "EvaluationLog" (
    "id" UUID NOT NULL,
    "noteId" UUID NOT NULL,
    "marketSnapshotId" UUID NOT NULL,
    "symbol" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "similarity" DOUBLE PRECISION NOT NULL,
    "level" TEXT NOT NULL,
    "triggered" BOOLEAN NOT NULL,
    "vectorDimension" INTEGER NOT NULL,
    "usedIndicators" TEXT[],
    "diagnostics" JSONB,
    "evaluatedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvaluationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_evallog_note_evaluated" ON "EvaluationLog"("noteId", "evaluatedAt");

-- CreateIndex
CREATE INDEX "idx_evallog_symbol_evaluated" ON "EvaluationLog"("symbol", "evaluatedAt");

-- CreateIndex
CREATE INDEX "idx_evallog_triggered_evaluated" ON "EvaluationLog"("triggered", "evaluatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "uq_evallog_note_snapshot_timeframe" ON "EvaluationLog"("noteId", "marketSnapshotId", "timeframe");

-- AddForeignKey
ALTER TABLE "EvaluationLog" ADD CONSTRAINT "EvaluationLog_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "TradeNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationLog" ADD CONSTRAINT "EvaluationLog_marketSnapshotId_fkey" FOREIGN KEY ("marketSnapshotId") REFERENCES "MarketSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
</file>

<file path="prisma/migrations/20260101233137_add_phase8_note_priority_batch_config/migration.sql">
-- CreateEnum
CREATE TYPE "NotificationSkipReason" AS ENUM ('max_simultaneous_exceeded', 'cooldown_active', 'note_disabled', 'note_paused', 'lower_priority');

-- AlterTable
ALTER TABLE "TradeNote" ADD COLUMN     "enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "pausedUntil" TIMESTAMPTZ(6),
ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 5;

-- CreateTable
CREATE TABLE "NotificationBatchConfig" (
    "id" UUID NOT NULL,
    "maxSimultaneous" INTEGER NOT NULL DEFAULT 3,
    "groupBySymbol" BOOLEAN NOT NULL DEFAULT true,
    "cooldownMinutes" INTEGER NOT NULL DEFAULT 15,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "NotificationBatchConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationSkipLog" (
    "id" UUID NOT NULL,
    "noteId" UUID NOT NULL,
    "matchResultId" UUID,
    "reason" "NotificationSkipReason" NOT NULL,
    "details" JSONB,
    "skippedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationSkipLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_notification_skip_note" ON "NotificationSkipLog"("noteId");

-- CreateIndex
CREATE INDEX "idx_notification_skip_at" ON "NotificationSkipLog"("skippedAt");

-- CreateIndex
CREATE INDEX "idx_notification_skip_reason" ON "NotificationSkipLog"("reason");

-- CreateIndex
CREATE INDEX "idx_tradenote_enabled_status" ON "TradeNote"("enabled", "status");

-- CreateIndex
CREATE INDEX "idx_tradenote_priority" ON "TradeNote"("priority");

-- AddForeignKey
ALTER TABLE "NotificationSkipLog" ADD CONSTRAINT "NotificationSkipLog_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "TradeNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationSkipLog" ADD CONSTRAINT "NotificationSkipLog_matchResultId_fkey" FOREIGN KEY ("matchResultId") REFERENCES "MatchResult"("id") ON DELETE SET NULL ON UPDATE CASCADE;
</file>

<file path="prisma/migrations/20260102164903_rename_note_status_active_archived/migration.sql">
/*
  NoteStatus マイグレーション: approved → active, rejected → archived
  
  変更内容:
  1. 既存データの status を approved → active, rejected → archived に変換
  2. enum NoteStatus の値を draft | active | archived に変更
  3. approvedAt → activatedAt, rejectedAt → archivedAt にカラム名変更
*/

-- Step 1: 新しい enum 型を作成
CREATE TYPE "NoteStatus_new" AS ENUM ('draft', 'active', 'archived');

-- Step 2: 既存データを変換しながら新しい enum 型に移行
ALTER TABLE "TradeNote" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "TradeNote" ALTER COLUMN "status" TYPE "NoteStatus_new" 
  USING (
    CASE "status"::text
      WHEN 'approved' THEN 'active'::"NoteStatus_new"
      WHEN 'rejected' THEN 'archived'::"NoteStatus_new"
      ELSE "status"::text::"NoteStatus_new"
    END
  );

-- Step 3: 古い enum 型を削除し、新しい型にリネーム
ALTER TYPE "NoteStatus" RENAME TO "NoteStatus_old";
ALTER TYPE "NoteStatus_new" RENAME TO "NoteStatus";
DROP TYPE "NoteStatus_old";

-- Step 4: デフォルト値を再設定
ALTER TABLE "TradeNote" ALTER COLUMN "status" SET DEFAULT 'draft';

-- Step 5: カラム名の変更（データを保持）
ALTER TABLE "TradeNote" RENAME COLUMN "approvedAt" TO "activatedAt";
ALTER TABLE "TradeNote" RENAME COLUMN "rejectedAt" TO "archivedAt";
</file>

<file path="prisma/migrations/20260102181629_add_data_preset_model/migration.sql">
-- CreateTable
CREATE TABLE "DataPreset" (
    "id" UUID NOT NULL,
    "symbol" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "startDate" TIMESTAMPTZ(6) NOT NULL,
    "endDate" TIMESTAMPTZ(6) NOT NULL,
    "recordCount" INTEGER NOT NULL,
    "name" TEXT,
    "description" TEXT,
    "sourceFile" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "DataPreset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_datapreset_symbol_timeframe" ON "DataPreset"("symbol", "timeframe");

-- CreateIndex
CREATE UNIQUE INDEX "uq_datapreset_symbol_timeframe" ON "DataPreset"("symbol", "timeframe");
</file>

<file path="prisma/migrations/20260103154346_add_source_to_backtest_and_montecarlo_history/migration.sql">
-- AlterTable
ALTER TABLE "StrategyBacktestRun" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'manual';

-- CreateTable
CREATE TABLE "MonteCarloRun" (
    "id" UUID NOT NULL,
    "strategyId" UUID NOT NULL,
    "backtestRunId" UUID,
    "iterations" INTEGER NOT NULL DEFAULT 100,
    "seed" INTEGER,
    "timeframe" TEXT NOT NULL DEFAULT '1h',
    "expectedWinRate" DOUBLE PRECISION NOT NULL,
    "expectedProfitFactor" DOUBLE PRECISION,
    "simulatedMeanWinRate" DOUBLE PRECISION NOT NULL,
    "simulatedMeanProfitFactor" DOUBLE PRECISION,
    "winRatePercentile" DOUBLE PRECISION NOT NULL,
    "profitFactorPercentile" DOUBLE PRECISION,
    "maxDrawdownPercentile" DOUBLE PRECISION,
    "totalProfitPercentile" DOUBLE PRECISION,
    "winRate5thPercentile" DOUBLE PRECISION,
    "winRate95thPercentile" DOUBLE PRECISION,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonteCarloRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_montecarlorun_strategyid" ON "MonteCarloRun"("strategyId");

-- CreateIndex
CREATE INDEX "idx_montecarlorun_created" ON "MonteCarloRun"("createdAt");

-- CreateIndex
CREATE INDEX "idx_strategybacktestrun_source" ON "StrategyBacktestRun"("source");

-- AddForeignKey
ALTER TABLE "MonteCarloRun" ADD CONSTRAINT "MonteCarloRun_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
</file>

<file path="prisma/migrations/20260103215649_add_side_b_tables/migration.sql">
-- CreateEnum
CREATE TYPE "VirtualTradeStatus" AS ENUM ('pending', 'open', 'closed', 'cancelled', 'expired');

-- CreateTable
CREATE TABLE "MarketResearch" (
    "id" UUID NOT NULL,
    "symbol" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL DEFAULT 'multi',
    "featureVector" JSONB NOT NULL,
    "regime" TEXT NOT NULL,
    "regimeConfidence" INTEGER NOT NULL,
    "trend" JSONB NOT NULL,
    "volatility" JSONB NOT NULL,
    "keyLevels" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "aiModel" TEXT NOT NULL,
    "tokenUsage" INTEGER,
    "rawIndicators" JSONB,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketResearch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AITradePlan" (
    "id" UUID NOT NULL,
    "researchId" UUID NOT NULL,
    "targetDate" DATE NOT NULL,
    "symbol" TEXT NOT NULL,
    "marketAnalysis" JSONB NOT NULL,
    "scenarios" JSONB NOT NULL,
    "overallConfidence" INTEGER,
    "warnings" TEXT[],
    "aiModel" TEXT,
    "tokenUsage" INTEGER,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AITradePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VirtualTrade" (
    "id" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "status" "VirtualTradeStatus" NOT NULL DEFAULT 'pending',
    "plannedEntry" DECIMAL(18,8) NOT NULL,
    "actualEntry" DECIMAL(18,8),
    "enteredAt" TIMESTAMPTZ(6),
    "stopLoss" DECIMAL(18,8) NOT NULL,
    "takeProfit" DECIMAL(18,8) NOT NULL,
    "exitPrice" DECIMAL(18,8),
    "exitedAt" TIMESTAMPTZ(6),
    "exitReason" TEXT,
    "pnlPips" DECIMAL(18,8),
    "pnlAmount" DECIMAL(18,8),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "VirtualTrade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_market_research_symbol" ON "MarketResearch"("symbol");

-- CreateIndex
CREATE INDEX "idx_market_research_created" ON "MarketResearch"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "idx_market_research_expires" ON "MarketResearch"("expiresAt");

-- CreateIndex
CREATE INDEX "idx_ai_trade_plan_date" ON "AITradePlan"("targetDate");

-- CreateIndex
CREATE INDEX "idx_ai_trade_plan_symbol" ON "AITradePlan"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "uq_ai_trade_plan_date_symbol" ON "AITradePlan"("targetDate", "symbol");

-- CreateIndex
CREATE INDEX "idx_virtual_trade_plan" ON "VirtualTrade"("planId");

-- CreateIndex
CREATE INDEX "idx_virtual_trade_status" ON "VirtualTrade"("status");

-- CreateIndex
CREATE INDEX "idx_virtual_trade_symbol" ON "VirtualTrade"("symbol");

-- AddForeignKey
ALTER TABLE "AITradePlan" ADD CONSTRAINT "AITradePlan_researchId_fkey" FOREIGN KEY ("researchId") REFERENCES "MarketResearch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VirtualTrade" ADD CONSTRAINT "VirtualTrade_planId_fkey" FOREIGN KEY ("planId") REFERENCES "AITradePlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
</file>

<file path="prisma/migrations/20260103225427_simplify_market_research/migration.sql">
/*
  Warnings:

  - You are about to drop the column `keyLevels` on the `MarketResearch` table. All the data in the column will be lost.
  - You are about to drop the column `rawIndicators` on the `MarketResearch` table. All the data in the column will be lost.
  - You are about to drop the column `regime` on the `MarketResearch` table. All the data in the column will be lost.
  - You are about to drop the column `regimeConfidence` on the `MarketResearch` table. All the data in the column will be lost.
  - You are about to drop the column `summary` on the `MarketResearch` table. All the data in the column will be lost.
  - You are about to drop the column `trend` on the `MarketResearch` table. All the data in the column will be lost.
  - You are about to drop the column `volatility` on the `MarketResearch` table. All the data in the column will be lost.

*/

-- Step 1: Add new column
ALTER TABLE "MarketResearch" ADD COLUMN "ohlcvSnapshot" JSONB;

-- Step 2: Migrate data from rawIndicators to ohlcvSnapshot
UPDATE "MarketResearch" SET "ohlcvSnapshot" = "rawIndicators" WHERE "rawIndicators" IS NOT NULL;

-- Step 3: Drop old columns
ALTER TABLE "MarketResearch" 
DROP COLUMN "keyLevels",
DROP COLUMN "rawIndicators",
DROP COLUMN "regime",
DROP COLUMN "regimeConfidence",
DROP COLUMN "summary",
DROP COLUMN "trend",
DROP COLUMN "volatility";
</file>

<file path="prisma/migrations/20260104011447_add_virtual_portfolio/migration.sql">
-- AlterEnum
ALTER TYPE "VirtualTradeStatus" ADD VALUE 'invalidated';

-- CreateTable
CREATE TABLE "VirtualPortfolio" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Default',
    "initialBalance" DECIMAL(18,2) NOT NULL DEFAULT 100000,
    "currentBalance" DECIMAL(18,2) NOT NULL DEFAULT 100000,
    "stats" JSONB NOT NULL DEFAULT '{}',
    "maxOpenPositions" INTEGER NOT NULL DEFAULT 3,
    "riskPercentPerTrade" DECIMAL(5,2) NOT NULL DEFAULT 1.0,
    "enableSpread" BOOLEAN NOT NULL DEFAULT false,
    "spreadPips" DECIMAL(5,2) NOT NULL DEFAULT 2.0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "VirtualPortfolio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_virtual_portfolio_name" ON "VirtualPortfolio"("name");
</file>

<file path="prisma/migrations/20260104215436_add_ai_trade_note/migration.sql">
-- CreateTable
CREATE TABLE "AITradeNote" (
    "id" UUID NOT NULL,
    "virtualTradeId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "symbol" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "pnlPips" DECIMAL(10,2) NOT NULL,
    "pnlPercentage" DECIMAL(10,4) NOT NULL,
    "rrActual" DECIMAL(5,2) NOT NULL,
    "holdingDuration" INTEGER NOT NULL,
    "entryAnalysis" JSONB NOT NULL,
    "exitAnalysis" JSONB NOT NULL,
    "planEvaluation" JSONB NOT NULL,
    "marketReview" JSONB NOT NULL,
    "learnings" JSONB NOT NULL,
    "similarPatterns" JSONB,
    "aiModel" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AITradeNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AINoteSummary" (
    "id" UUID NOT NULL,
    "period" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "statistics" JSONB NOT NULL,
    "analysis" JSONB NOT NULL,
    "summary" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AINoteSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AITradeNote_virtualTradeId_key" ON "AITradeNote"("virtualTradeId");

-- CreateIndex
CREATE INDEX "idx_ai_trade_note_date" ON "AITradeNote"("date");

-- CreateIndex
CREATE INDEX "idx_ai_trade_note_outcome" ON "AITradeNote"("outcome");

-- CreateIndex
CREATE INDEX "idx_ai_trade_note_symbol" ON "AITradeNote"("symbol");

-- CreateIndex
CREATE INDEX "idx_ai_note_summary_period" ON "AINoteSummary"("period", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "uq_ai_note_summary_period" ON "AINoteSummary"("period", "startDate", "endDate");

-- AddForeignKey
ALTER TABLE "AITradeNote" ADD CONSTRAINT "AITradeNote_virtualTradeId_fkey" FOREIGN KEY ("virtualTradeId") REFERENCES "VirtualTrade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AITradeNote" ADD CONSTRAINT "AITradeNote_planId_fkey" FOREIGN KEY ("planId") REFERENCES "AITradePlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
</file>

<file path="prisma/migrations/20260105231808_add_ctrader_token/migration.sql">
-- CreateTable
CREATE TABLE "CTraderToken" (
    "id" UUID NOT NULL,
    "accountId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "scope" TEXT,
    "lastConnectedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "CTraderToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CTraderToken_accountId_key" ON "CTraderToken"("accountId");

-- CreateIndex
CREATE INDEX "idx_ctrader_token_expires" ON "CTraderToken"("expiresAt");
</file>

<file path="prisma/migrations/20260108143748_add_tick_and_realtime_ohlcv/migration.sql">
-- CreateEnum
CREATE TYPE "OptimizationMethod" AS ENUM ('mean_variance', 'risk_parity', 'equal_weight', 'minimum_variance', 'max_sharpe');

-- CreateTable
CREATE TABLE "TickData" (
    "id" UUID NOT NULL,
    "symbol" TEXT NOT NULL,
    "timestamp" TIMESTAMPTZ(6) NOT NULL,
    "bid" DECIMAL(18,8) NOT NULL,
    "ask" DECIMAL(18,8) NOT NULL,
    "mid" DECIMAL(18,8) NOT NULL,
    "spread" DECIMAL(18,8) NOT NULL,
    "volume" DECIMAL(18,8),
    "source" TEXT NOT NULL DEFAULT 'ctrader',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TickData_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RealtimeOHLCV" (
    "id" UUID NOT NULL,
    "symbol" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "timestamp" TIMESTAMPTZ(6) NOT NULL,
    "open" DECIMAL(18,8) NOT NULL,
    "high" DECIMAL(18,8) NOT NULL,
    "low" DECIMAL(18,8) NOT NULL,
    "close" DECIMAL(18,8) NOT NULL,
    "volume" DECIMAL(18,8) NOT NULL,
    "tickCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RealtimeOHLCV_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyComparisonSession" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "strategyIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "timeframe" TEXT NOT NULL DEFAULT '1h',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "StrategyComparisonSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyComparisonResult" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "strategyId" UUID NOT NULL,
    "totalTrades" INTEGER NOT NULL,
    "winRate" DOUBLE PRECISION NOT NULL,
    "profitFactor" DOUBLE PRECISION,
    "netProfit" DECIMAL(18,8) NOT NULL,
    "maxDrawdown" DECIMAL(18,8) NOT NULL,
    "sharpeRatio" DOUBLE PRECISION,
    "sortinoRatio" DOUBLE PRECISION,
    "calmarRatio" DOUBLE PRECISION,
    "dailyReturns" JSONB,
    "equityCurve" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrategyComparisonResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyCorrelation" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "strategyAId" UUID NOT NULL,
    "strategyBId" UUID NOT NULL,
    "pearsonCorr" DOUBLE PRECISION NOT NULL,
    "spearmanCorr" DOUBLE PRECISION,
    "coWinRate" DOUBLE PRECISION,
    "coLossRate" DOUBLE PRECISION,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrategyCorrelation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortfolioOptimization" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "method" "OptimizationMethod" NOT NULL,
    "weights" JSONB NOT NULL,
    "expectedReturn" DOUBLE PRECISION NOT NULL,
    "expectedRisk" DOUBLE PRECISION NOT NULL,
    "sharpeRatio" DOUBLE PRECISION,
    "efficientFrontier" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortfolioOptimization_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_tick_symbol_timestamp" ON "TickData"("symbol", "timestamp");

-- CreateIndex
CREATE INDEX "idx_tick_timestamp" ON "TickData"("timestamp");

-- CreateIndex
CREATE INDEX "idx_realtime_ohlcv_symbol_tf_ts" ON "RealtimeOHLCV"("symbol", "timeframe", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "uq_realtime_ohlcv" ON "RealtimeOHLCV"("symbol", "timeframe", "timestamp");

-- CreateIndex
CREATE INDEX "idx_comparison_session_created" ON "StrategyComparisonSession"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "idx_comparison_result_session" ON "StrategyComparisonResult"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "uq_comparison_result_session_strategy" ON "StrategyComparisonResult"("sessionId", "strategyId");

-- CreateIndex
CREATE INDEX "idx_correlation_session" ON "StrategyCorrelation"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "uq_correlation_session_pair" ON "StrategyCorrelation"("sessionId", "strategyAId", "strategyBId");

-- CreateIndex
CREATE INDEX "idx_optimization_session" ON "PortfolioOptimization"("sessionId");

-- AddForeignKey
ALTER TABLE "StrategyComparisonResult" ADD CONSTRAINT "StrategyComparisonResult_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "StrategyComparisonSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyCorrelation" ADD CONSTRAINT "StrategyCorrelation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "StrategyComparisonSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioOptimization" ADD CONSTRAINT "PortfolioOptimization_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "StrategyComparisonSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
</file>

<file path="prisma/migrations/20260114050906_ctrader_only_auth/migration.sql">
-- cTrader統合認証への全面移行マイグレーション
-- 警告: このマイグレーションは既存のユーザーデータをクリアします

-- Step 1: 既存データのバックアップ（必要に応じて手動で実行）
-- CREATE TABLE "User_backup" AS SELECT * FROM "User";
-- CREATE TABLE "CTraderToken_backup" AS SELECT * FROM "CTraderToken";

-- Step 2: 外部キー制約のあるテーブルからユーザー参照を一時削除
-- Watchlist と PushSubscription は User に依存しているため、先にクリア
DELETE FROM "Watchlist";
DELETE FROM "PushSubscription";

-- Step 3: 既存のユーザーとトークンを削除
DELETE FROM "User";
DELETE FROM "CTraderToken";

-- Step 4: User テーブルのインデックスを削除
DROP INDEX IF EXISTS "idx_user_email";

-- Step 5: User テーブルから不要なカラムを削除
ALTER TABLE "User" DROP COLUMN IF EXISTS "email";
ALTER TABLE "User" DROP COLUMN IF EXISTS "passwordHash";
ALTER TABLE "User" DROP COLUMN IF EXISTS "refreshToken";

-- Step 6: User テーブルに新しいカラムを追加
ALTER TABLE "User" ADD COLUMN "primaryAccountId" TEXT NOT NULL DEFAULT 'temp';
ALTER TABLE "User" ADD COLUMN "email" TEXT;

-- Step 7: primaryAccountId を UNIQUE にする
ALTER TABLE "User" ADD CONSTRAINT "User_primaryAccountId_key" UNIQUE ("primaryAccountId");

-- Step 8: インデックスを追加
CREATE INDEX "idx_user_primary_account" ON "User"("primaryAccountId");

-- Step 9: CTraderToken テーブルに userId カラムを追加
ALTER TABLE "CTraderToken" ADD COLUMN "userId" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000';

-- Step 10: CTraderToken に外部キー制約を追加
ALTER TABLE "CTraderToken" 
  ADD CONSTRAINT "CTraderToken_userId_fkey" 
  FOREIGN KEY ("userId") 
  REFERENCES "User"("id") 
  ON DELETE CASCADE 
  ON UPDATE CASCADE;

-- Step 11: CTraderToken にインデックスを追加
CREATE INDEX "idx_ctradertoken_userid" ON "CTraderToken"("userId");

-- Step 12: デフォルト値を削除
ALTER TABLE "User" ALTER COLUMN "primaryAccountId" DROP DEFAULT;
ALTER TABLE "CTraderToken" ALTER COLUMN "userId" DROP DEFAULT;

-- マイグレーション完了
-- ユーザーは cTrader OAuth でのみログイン可能になります
</file>

<file path="prisma/migrations/20260215205536_init/migration.sql">
/*
  注意:

  本番DBには既存データがあるため、
  - DROP COLUMN → ADD COLUMN NOT NULL（デフォルトなし）
  は失敗します。

  このマイグレーションでは、既存の `Strategy.side`（TradeSide）を
  `StrategyDirection` へ安全に型変換します。
*/

-- CreateEnum（既に存在する場合はスキップ）
DO $$
BEGIN
  CREATE TYPE "StrategyDirection" AS ENUM ('buy', 'sell', 'both');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable: TradeSide → StrategyDirection へ型変換（既存データを保持）
ALTER TABLE "Strategy"
  ALTER COLUMN "side" TYPE "StrategyDirection"
  USING ("side"::text::"StrategyDirection");

-- AlterTable: StrategyVersion に symbol/side を追加（既存行があるため NULL許容）
ALTER TABLE "StrategyVersion"
  ADD COLUMN IF NOT EXISTS "side" "StrategyDirection",
  ADD COLUMN IF NOT EXISTS "symbol" TEXT;

-- 既存バージョンへ Strategy の symbol/side をバックフィル
UPDATE "StrategyVersion" v
SET
  "symbol" = COALESCE(v."symbol", s."symbol"),
  "side" = COALESCE(v."side", s."side")
FROM "Strategy" s
WHERE v."strategyId" = s."id";
</file>

<file path="prisma/migrations/20260409120000_add_chart_drawing/migration.sql">
-- チャート描画データ同期テーブル
CREATE TABLE IF NOT EXISTS "ChartDrawing" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "symbol" TEXT NOT NULL,
  "timeframe" TEXT NOT NULL,
  "lines" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "ChartDrawing_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_chart_drawing_user_symbol_timeframe"
  ON "ChartDrawing" ("userId", "symbol", "timeframe");

CREATE INDEX IF NOT EXISTS "idx_chart_drawing_user_updated"
  ON "ChartDrawing" ("userId", "updatedAt");
</file>

<file path="prisma/migrations/20260409140000_enable_rls_all_tables/migration.sql">
-- ============================================================
-- 全アプリテーブルで Row Level Security (RLS) を有効化
-- ============================================================
-- 目的:
-- - Supabase の anon / authenticated が PostgREST 経由でテーブルに触れないようにする
-- - ポリシー未作成のため、上記ロールは行へのアクセス不可（デフォルト拒否）
-- - Prisma は service_role で接続する想定のため RLS をバイパスし、既存動作は維持される
-- 参照: 技術的負債 D1（RLS 未設定リスク）の解消
-- ============================================================

ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Watchlist" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ChartDrawing" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Trade" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TradeNote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AISummary" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MarketSnapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MatchResult" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrderPreset" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificationLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EvaluationLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DataPreset" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OHLCVCandle" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TradeNoteRaw" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RevaluationJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BacktestRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BacktestResult" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BacktestEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PushSubscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PushLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MatchDetail" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Strategy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StrategyVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StrategyNote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StrategyBacktestRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StrategyBacktestResult" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StrategyBacktestEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StrategyAlert" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StrategyAlertLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WalkForwardRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WalkForwardSplit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MonteCarloRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificationBatchConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificationSkipLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MarketResearch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AITradePlan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VirtualTrade" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VirtualPortfolio" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AITradeNote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AINoteSummary" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CTraderToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TickData" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RealtimeOHLCV" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StrategyComparisonSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StrategyComparisonResult" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StrategyCorrelation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PortfolioOptimization" ENABLE ROW LEVEL SECURITY;
</file>

<file path="prisma/migrations/20260417000000_add_ai_trade_note_lens_snapshot/migration.sql">
-- Phase 1: 並列レンズ基盤
-- AITradeNote に lensSnapshot (JSONB, nullable) カラムを追加
-- 既存 114 件のトレードは NULL のまま互換性を維持する

ALTER TABLE "AITradeNote" ADD COLUMN "lensSnapshot" JSONB;
</file>

<file path="prisma/migrations/20260418000000_add_edge_hypothesis/migration.sql">
-- Phase 4a: エッジ仮説台帳
-- EdgeHypothesis テーブルを新規作成
-- AITradeNote に relatedHypothesisIds カラムを追加

-- ============================================================
-- EdgeHypothesis テーブル
-- ============================================================
CREATE TABLE "EdgeHypothesis" (
    "id" UUID NOT NULL,

    -- 記述
    "statement" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "conditions" JSONB NOT NULL,
    "expectedDirection" TEXT NOT NULL,

    -- ライフサイクル
    "status" TEXT NOT NULL DEFAULT 'unverified',
    "statusUpdatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "statusNote" TEXT,

    -- 対象
    "symbols" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "timeframes" TEXT[] DEFAULT ARRAY[]::TEXT[],

    -- 実績
    "observationCount" INTEGER NOT NULL DEFAULT 0,
    "winCount" INTEGER NOT NULL DEFAULT 0,
    "lossCount" INTEGER NOT NULL DEFAULT 0,
    "breakevenCount" INTEGER NOT NULL DEFAULT 0,
    "totalPnlPips" DECIMAL(12, 2) NOT NULL DEFAULT 0,
    "avgRR" DECIMAL(6, 3) NOT NULL DEFAULT 0,

    -- 検証履歴（Phase 4b で埋まる）
    "backtestResults" JSONB,
    "walkForwardResults" JSONB,

    -- メタデータ
    "source" TEXT NOT NULL,
    "lensRelevance" JSONB,

    -- タイムスタンプ
    "firstObservedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastObservedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastTestedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    -- 関連
    "parentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "relatedNoteIds" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "EdgeHypothesis_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_edge_hypothesis_status" ON "EdgeHypothesis"("status");
CREATE INDEX "idx_edge_hypothesis_category" ON "EdgeHypothesis"("category");
CREATE INDEX "idx_edge_hypothesis_source" ON "EdgeHypothesis"("source");
CREATE INDEX "idx_edge_hypothesis_created" ON "EdgeHypothesis"("createdAt" DESC);

-- ============================================================
-- AITradeNote.relatedHypothesisIds 追加
-- ============================================================
ALTER TABLE "AITradeNote"
ADD COLUMN "relatedHypothesisIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
</file>

<file path="prisma/migrations/20260418120000_add_phase_4b_bridge_fields/migration.sql">
-- Phase 4b: Side-A 検証基盤へのブリッジ層
-- AITradeNote.tradeNoteId と EdgeHypothesis のブリッジ用フィールドを追加

-- ============================================================
-- AITradeNote.tradeNoteId 追加（同時生成された Side-A TradeNote への参照）
-- ============================================================
ALTER TABLE "AITradeNote"
ADD COLUMN "tradeNoteId" UUID;

-- ============================================================
-- EdgeHypothesis: ブリッジ層用フィールド追加
-- ============================================================
ALTER TABLE "EdgeHypothesis"
ADD COLUMN "defaultRiskManagement" JSONB,
ADD COLUMN "materializedTradeNoteIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "invalidationConditions" JSONB,
ADD COLUMN "confirmationNote" TEXT;
</file>

<file path="prisma/migrations/20260418180000_add_screening_result/migration.sql">
-- Phase 4b 縮小版: EdgeHypothesis.screeningResult 追加
-- Side-A BacktestService による事前スクリーニング結果を記録するための JSON フィールド。
-- EdgeStatus は文字列ベース（String @default("unverified")）のため、
-- 新ステータス 'screening_passed' を追加するためのスキーマ変更は不要。

ALTER TABLE "EdgeHypothesis"
ADD COLUMN "screeningResult" JSONB;
</file>

<file path="prisma/migrations/20260419000000_add_phase_4c_validation_report/migration.sql">
-- Phase 4c: EdgeHypothesis に本格検証レポート用フィールドを追加
-- StrategistAgent / BacktesterAgent が埋める。全て NULL 許容で後方互換維持。

ALTER TABLE "EdgeHypothesis"
ADD COLUMN "fullValidationReport" JSONB,
ADD COLUMN "confirmationInterpretation" TEXT,
ADD COLUMN "rejectionInterpretation" TEXT,
ADD COLUMN "actionableInsights" TEXT[] DEFAULT ARRAY[]::TEXT[];
</file>

<file path="prisma/migrations/20260422000000_add_phase_6_prompt_registry/migration.sql">
-- Phase 6: プロンプト進化基盤テーブル追加
-- PromptVersion / PromptAbTestResult / AgentRestructureProposal

-- CreateTable
CREATE TABLE "PromptVersion" (
    "id" UUID NOT NULL,
    "agentName" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "parentVersionId" UUID,
    "createdBy" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'experimental',
    "notes" TEXT,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "avgScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMPTZ(6),
    "approvedAt" TIMESTAMPTZ(6),
    "approvedBy" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromptVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_prompt_version_agent_version" ON "PromptVersion"("agentName", "version");

-- CreateIndex
CREATE INDEX "idx_prompt_version_agent_status" ON "PromptVersion"("agentName", "status");

-- CreateIndex
CREATE INDEX "idx_prompt_version_status" ON "PromptVersion"("status");

-- CreateIndex
CREATE INDEX "idx_prompt_version_created" ON "PromptVersion"("createdAt" DESC);

-- CreateTable
CREATE TABLE "PromptAbTestResult" (
    "id" UUID NOT NULL,
    "agentName" TEXT NOT NULL,
    "variantIds" JSONB NOT NULL,
    "variantResults" JSONB NOT NULL,
    "winnerVersionId" UUID,
    "inputDigest" TEXT,
    "testedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptAbTestResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_prompt_abtest_agent_tested" ON "PromptAbTestResult"("agentName", "testedAt" DESC);

-- CreateTable
CREATE TABLE "AgentRestructureProposal" (
    "id" UUID NOT NULL,
    "proposal" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMPTZ(6),
    "executionResult" JSONB,
    "executedAt" TIMESTAMPTZ(6),
    "approvalNotes" TEXT,
    "proposedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentRestructureProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_agent_restructure_status_proposed" ON "AgentRestructureProposal"("status", "proposedAt" DESC);
</file>

<file path="prisma/migrations/20260422010000_enable_rls_phase_6_tables/migration.sql">
-- ============================================================
-- Phase 6 で追加したテーブルに Row Level Security (RLS) を有効化
-- ============================================================
-- 目的:
-- - 20260409140000_enable_rls_all_tables と同じ方針: Supabase の anon / authenticated
--   が PostgREST 経由でこれらのテーブルに触れないようにする (デフォルト拒否)
-- - Prisma は service_role で接続する想定のため RLS をバイパスし、既存動作は維持される
-- - Phase 6 追加の EdgeHypothesis も同じ扱いにする
-- ============================================================

ALTER TABLE "PromptVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PromptAbTestResult" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentRestructureProposal" ENABLE ROW LEVEL SECURITY;

-- EdgeHypothesis は 20260418000000 で追加されたが 20260409140000 のリストには
-- 含まれていないので、ここでまとめて有効化する
ALTER TABLE "EdgeHypothesis" ENABLE ROW LEVEL SECURITY;
</file>

<file path="prisma/migrations/20260425134500_add_spread_bar/migration.sql">
-- CreateTable
CREATE TABLE "SpreadBar" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "symbol" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "timestamp" TIMESTAMPTZ(6) NOT NULL,
    "avgSpread" DECIMAL(18,8) NOT NULL,
    "maxSpread" DECIMAL(18,8) NOT NULL,
    "p95Spread" DECIMAL(18,8) NOT NULL,
    "tickCount" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'ctrader',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "SpreadBar_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_spreadbar_symbol_timeframe_timestamp" ON "SpreadBar"("symbol", "timeframe", "timestamp");

-- CreateIndex
CREATE INDEX "idx_spreadbar_symbol_tf_ts" ON "SpreadBar"("symbol", "timeframe", "timestamp");

-- CreateIndex
CREATE INDEX "idx_spreadbar_symbol_ts" ON "SpreadBar"("symbol", "timestamp");
</file>

<file path="prisma/migrations/migration_lock.toml">
# Please do not edit this file manually
# It should be added in your version-control system (e.g., Git)
provider = "postgresql"
</file>

<file path="prisma/migrations/20260503010000_add_screening_backtest_run/migration.sql">
-- CreateTable
-- Critical-4 段階 1: 仮説スクリーニング BT 実行履歴
-- analysis-engine 経由で実行された BT 結果を保存する。
CREATE TABLE "ScreeningBacktestRun" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "hypothesisId" UUID NOT NULL,
    "symbol" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "periodStart" TIMESTAMPTZ(6) NOT NULL,
    "periodEnd" TIMESTAMPTZ(6) NOT NULL,
    "notePayload" JSONB NOT NULL,
    "summary" JSONB NOT NULL,
    "trades" JSONB NOT NULL,
    "equity" JSONB,
    "engineVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScreeningBacktestRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_screening_bt_hyp_created" ON "ScreeningBacktestRun"("hypothesisId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "idx_screening_bt_symbol_tf" ON "ScreeningBacktestRun"("symbol", "timeframe");
</file>

<file path="prisma/migrations/20260503020000_drop_legacy_backtest_tables/migration.sql">
-- Critical-4 段階 3b: 旧 BT 系統のテーブル完全廃止
--
-- 削除対象:
--   - BacktestEvent (BT 個別イベント、BacktestRun に FK)
--   - BacktestResult (BT 集計結果、BacktestRun に FK)
--   - BacktestRun (BT 実行条件、TradeNote.backtestRuns リレーション元)
--
-- 削除順は外部キー依存に従う: Event → Result → Run
-- TradeNote.backtestRuns リレーションは schema.prisma 側で削除済み
-- Enum BacktestStatus / BacktestOutcome は StrategyBacktestRun / StrategyBacktestEvent /
-- WalkForwardRun 等で引き続き使用するため残す

-- BacktestEvent
DROP INDEX IF EXISTS "idx_backtestevent_run_entry";
ALTER TABLE IF EXISTS "BacktestEvent" DROP CONSTRAINT IF EXISTS "BacktestEvent_runId_fkey";
DROP TABLE IF EXISTS "BacktestEvent";

-- BacktestResult
ALTER TABLE IF EXISTS "BacktestResult" DROP CONSTRAINT IF EXISTS "BacktestResult_runId_fkey";
DROP TABLE IF EXISTS "BacktestResult";

-- BacktestRun
DROP INDEX IF EXISTS "idx_backtestrun_noteid";
DROP INDEX IF EXISTS "idx_backtestrun_status_created";
ALTER TABLE IF EXISTS "BacktestRun" DROP CONSTRAINT IF EXISTS "BacktestRun_noteId_fkey";
DROP TABLE IF EXISTS "BacktestRun";
</file>

<file path="prisma/migrations/20260503030000_add_evolution_backtest_run/migration.sql">
-- CreateTable
-- Critical-4 段階 4a.4: 進化ループ正式 BT 履歴
-- EvolutionLoop top K の analysis-engine 正式 BT 結果を保存する。
-- ScreeningBacktestRun (= EdgeHypothesis 由来) とは別テーブルで管理する。
CREATE TABLE "EvolutionBacktestRun" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "evolutionRunId" UUID NOT NULL,
    "generation" INTEGER NOT NULL,
    "candidateId" TEXT NOT NULL,
    "candidateHash" TEXT NOT NULL,
    "dslSnapshot" JSONB NOT NULL,
    "surrogateScore" DOUBLE PRECISION NOT NULL,
    "formalBtPassed" BOOLEAN NOT NULL,
    "formalBtMetrics" JSONB,
    "formalBtFailureReason" TEXT,
    "engine" TEXT NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvolutionBacktestRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_evolution_bt_run_gen" ON "EvolutionBacktestRun"("evolutionRunId", "generation");

-- CreateIndex
CREATE INDEX "idx_evolution_bt_hash_created" ON "EvolutionBacktestRun"("candidateHash", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "idx_evolution_bt_passed_created" ON "EvolutionBacktestRun"("formalBtPassed", "createdAt" DESC);

-- RLS: Phase 6.5 ポリシー (anon/authenticated 拒否、service_role バイパス)
ALTER TABLE "EvolutionBacktestRun" ENABLE ROW LEVEL SECURITY;
</file>

<file path="prisma/migrations/20260509000000_phase_b1_evolution_bt_trades/migration.sql">
-- Filter Evolution Phase B-1 (2026-05-09):
-- EvolutionBacktestRun に trade list を JSON 列として永続化。
-- 設計書: docs/review/2026-05-09_agent_loop_diagnosis_and_plan.md §5.B.3
--
-- 既存行 (Phase B-1 以前) は NULL のまま。NULL 対応は計算側 helper で
-- notComputable 経路を踏む (= Win Rate Lift / parentLossTrades の M2/M3 既存実装が
-- そのまま機能)。
--
-- 各要素 shape: { entryTime: ISO8601, side: 'long'|'short', pnl: number, outcome: 'win'|'loss'|'timeout' }
ALTER TABLE "EvolutionBacktestRun" ADD COLUMN "trades" JSONB;
</file>

<file path="prisma/migrations/20260509010000_phase_b2_evolution_carry/migration.sql">
-- Filter Evolution Phase B-2 (2026-05-09):
-- 進化ループ世代間で引き継ぐ短命 state を永続化するテーブル。
-- 設計書: docs/review/2026-05-09_agent_loop_diagnosis_and_plan.md §5.B.2
--
-- 用途:
--   - cron 起動を跨いだ in-memory cache (tradesByDslId / lastRepairHints /
--     lastRepairBaselines) の復元
--   - 新規 cron 起動時に regime 単位で最新 carry を 1 件読み出して初期値に使う
--
-- retention 14 日 (= Phase B-3 で cron job が古い行を条件付き DELETE する想定、
-- 具体的には `EvolutionInstanceCarryRepository.deleteOlderThan(14)` を呼ぶ)。
CREATE TABLE "EvolutionInstanceCarry" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "evolutionRunId" UUID NOT NULL,
    "regime" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "recordedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvolutionInstanceCarry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_evolution_carry_run_regime_gen" ON "EvolutionInstanceCarry"("evolutionRunId", "regime", "generation");

-- CreateIndex
CREATE INDEX "idx_evolution_carry_regime_recorded" ON "EvolutionInstanceCarry"("regime", "recordedAt" DESC);

-- CreateIndex
CREATE INDEX "idx_evolution_carry_recorded" ON "EvolutionInstanceCarry"("recordedAt" DESC);
</file>

<file path="prisma/migrations/20260509020000_phase_d1a_generation_lesson/migration.sql">
-- Filter Evolution Phase D-1a (2026-05-09):
-- 世代単位の reflection lessons を永続化するテーブル。
-- 設計書: docs/review/2026-05-09_agent_loop_diagnosis_and_plan.md §5.B.1 / §5.D
--
-- GenerationReflectionAgent (= Phase D-1b 実装予定) が出す verbal lesson を保存する。
-- 用途:
--   - 後続世代の mutation/crossover prompt に lesson を流す
--   - PDCA loop の thinking log に世代単位の振り返りを残す
--   - 観察フェーズで「学習が機能しているか」を定量確認 (= 設計書 §3.3 観測条件 4)
CREATE TABLE "GenerationLesson" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "evolutionRunId" UUID NOT NULL,
    "regime" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "lesson" TEXT NOT NULL,
    "metrics" JSONB,
    "confidence" DOUBLE PRECISION,
    "recordedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GenerationLesson_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_gen_lesson_run_regime_gen" ON "GenerationLesson"("evolutionRunId", "regime", "generation");

-- CreateIndex
CREATE INDEX "idx_gen_lesson_regime_recorded" ON "GenerationLesson"("regime", "recordedAt" DESC);

-- CreateIndex
CREATE INDEX "idx_gen_lesson_category_recorded" ON "GenerationLesson"("category", "recordedAt" DESC);
</file>

<file path="prisma/schema.prisma">
generator client {
  provider      = "prisma-client-js"
  binaryTargets = ["native", "linux-musl-openssl-3.0.x"]
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}

/// ユーザー（cTrader OAuth 認証用）
model User {
  id                String             @id @default(uuid()) @db.Uuid
  /// プライマリcTraderアカウントID（初回ログイン時に設定）
  primaryAccountId  String             @unique
  /// 表示名（cTrader から取得、またはユーザーが設定）
  displayName       String?
  /// メールアドレス（cTrader から取得、任意）
  email             String?
  /// ロール
  role              UserRole           @default(user)
  /// アカウント有効フラグ
  active            Boolean            @default(true)
  /// 最終ログイン日時
  lastLoginAt       DateTime?          @db.Timestamptz(6)
  /// 作成日時
  createdAt         DateTime           @default(now()) @db.Timestamptz(6)
  /// 更新日時
  updatedAt         DateTime           @updatedAt @db.Timestamptz(6)
  ctraderTokens     CTraderToken[]     @relation("UserCTraderTokens")
  pushSubscriptions PushSubscription[] @relation("UserPushSubscriptions")
  watchlists        Watchlist[]

  @@index([primaryAccountId], map: "idx_user_primary_account")
  @@index([active], map: "idx_user_active")
}

/// ウォッチリスト（監視対象シンボル）
/// 日次OHLCV蓄積の対象シンボルを管理
model Watchlist {
  id         String   @id @default(uuid()) @db.Uuid
  /// ユーザー ID
  userId     String   @db.Uuid
  /// シンボル（例: USDJPY, EURUSD, XAUUSD）
  symbol     String
  /// 取得する時間足（例: ["15m", "1h", "4h"]）
  timeframes String[] @default(["15m", "1h"])
  /// 有効フラグ
  active     Boolean  @default(true)
  /// メモ（例: 主要通貨ペア）
  notes      String?
  /// 作成日時
  createdAt  DateTime @default(now()) @db.Timestamptz(6)
  /// 更新日時
  updatedAt  DateTime @updatedAt @db.Timestamptz(6)
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, symbol], map: "uq_watchlist_user_symbol")
  @@index([userId, active], map: "idx_watchlist_user_active")
  @@index([active], map: "idx_watchlist_active")
}

/// チャート描画データ（ユーザー×シンボル×時間足）
/// ライン編集のデバイス間同期に使用
model ChartDrawing {
  id        String   @id @default(uuid()) @db.Uuid
  /// ユーザー ID
  userId    String   @db.Uuid
  /// シンボル（例: XAUUSD）
  symbol    String
  /// 時間足（秒ベース文字列）
  timeframe String
  /// 描画ライン配列（JSON）
  lines     Json
  /// 作成日時
  createdAt DateTime @default(now()) @db.Timestamptz(6)
  /// 更新日時
  updatedAt DateTime @updatedAt @db.Timestamptz(6)

  @@unique([userId, symbol, timeframe], map: "uq_chart_drawing_user_symbol_timeframe")
  @@index([userId, updatedAt], map: "idx_chart_drawing_user_updated")
}

model Trade {
  id        String     @id @default(uuid()) @db.Uuid
  timestamp DateTime   @db.Timestamptz(6)
  symbol    String
  side      TradeSide
  price     Decimal    @db.Decimal(18, 8)
  quantity  Decimal    @db.Decimal(18, 8)
  fee       Decimal?   @db.Decimal(18, 8)
  exchange  String?
  createdAt DateTime   @default(now()) @db.Timestamptz(6)
  updatedAt DateTime   @updatedAt @db.Timestamptz(6)
  note      TradeNote?

  @@index([symbol, timestamp], map: "idx_trade_symbol_timestamp")
}

model TradeNote {
  id              String     @id @default(uuid()) @db.Uuid
  tradeId         String     @unique @db.Uuid
  symbol          String
  entryPrice      Decimal    @db.Decimal(18, 8)
  side            TradeSide
  indicators      Json?
  featureVector   Float[]
  timeframe       String?
  createdAt       DateTime   @default(now()) @db.Timestamptz(6)
  updatedAt       DateTime   @updatedAt @db.Timestamptz(6)
  /// 有効化日時
  activatedAt     DateTime?  @db.Timestamptz(6)
  /// 最終編集日時
  lastEditedAt    DateTime?  @db.Timestamptz(6)
  /// トレード時点の市場コンテキスト（JSON: trend, calculatedIndicators等）
  marketContext   Json?
  /// アーカイブ日時
  archivedAt      DateTime?  @db.Timestamptz(6)
  /// 承認状態（draft: 下書き、active: 有効、archived: アーカイブ）
  status          NoteStatus @default(draft)
  /// タグ（検索用）
  tags            String[]   @default([])
  /// ユーザーによる追記コメント
  userNotes       String?
  /// ノート固有のインジケーター設定（NoteIndicatorConfig 型の JSON）
  /// グローバル設定とは別に、このノート独自の評価ロジックを定義可能
  indicatorConfig Json?

  // === フェーズ8: 複数ノート運用UX ===
  /// ノート優先度（1-10、高いほど優先。同時ヒット時のソートに使用）
  priority    Int       @default(5)
  /// 有効フラグ（false の場合、マッチング対象から除外）
  enabled     Boolean   @default(true)
  /// 一時停止（この日時まで無効。null の場合は停止なし）
  pausedUntil DateTime? @db.Timestamptz(6)

  aiSummary            AISummary?
  evaluationLogs       EvaluationLog[]       @relation("EvaluationLogNote")
  matchResult          MatchResult[]
  notificationLogs     NotificationLog[]     @relation("NotificationLogNote")
  notificationSkipLogs NotificationSkipLog[] @relation("NotificationSkipLogNote")
  trade                Trade                 @relation(fields: [tradeId], references: [id])

  @@index([symbol], map: "idx_tradenote_symbol")
  @@index([status], map: "idx_tradenote_status")
  @@index([symbol, status], map: "idx_tradenote_symbol_status")
  @@index([enabled, status], map: "idx_tradenote_enabled_status")
  @@index([priority], map: "idx_tradenote_priority")
}

model AISummary {
  id               String    @id @default(uuid()) @db.Uuid
  noteId           String    @unique @db.Uuid
  summary          String
  promptTokens     Int?
  completionTokens Int?
  model            String?
  createdAt        DateTime  @default(now()) @db.Timestamptz(6)
  note             TradeNote @relation(fields: [noteId], references: [id])
}

model MarketSnapshot {
  id               String            @id @default(uuid()) @db.Uuid
  symbol           String
  timeframe        String
  close            Decimal           @db.Decimal(18, 8)
  volume           Decimal           @db.Decimal(18, 8)
  indicators       Json
  fetchedAt        DateTime          @db.Timestamptz(6)
  createdAt        DateTime          @default(now()) @db.Timestamptz(6)
  evaluationLogs   EvaluationLog[]   @relation("EvaluationLogSnapshot")
  matchResults     MatchResult[]
  notificationLogs NotificationLog[] @relation("NotificationLogSnapshot")

  @@unique([symbol, timeframe, fetchedAt], map: "uq_snapshot_symbol_timeframe_fetched")
  @@index([symbol, timeframe], map: "idx_snapshot_symbol_timeframe")
}

model MatchResult {
  id                   String                @id @default(uuid()) @db.Uuid
  noteId               String                @db.Uuid
  marketSnapshotId     String                @db.Uuid
  symbol               String
  score                Float
  threshold            Float
  trendMatched         Boolean
  priceRangeMatched    Boolean
  decidedAt            DateTime              @default(now()) @db.Timestamptz(6)
  createdAt            DateTime              @default(now()) @db.Timestamptz(6)
  evaluatedAt          DateTime              @default(now()) @db.Timestamptz(6)
  reasons              Json
  marketSnapshot       MarketSnapshot        @relation(fields: [marketSnapshotId], references: [id])
  note                 TradeNote             @relation(fields: [noteId], references: [id])
  notifications        Notification[]
  notificationSkipLogs NotificationSkipLog[] @relation("NotificationSkipLogMatch")
  orderPresets         OrderPreset[]

  @@unique([noteId, marketSnapshotId], map: "uq_match_note_snapshot")
  @@index([symbol, decidedAt], map: "idx_match_symbol_decided")
}

model Notification {
  id            String             @id @default(uuid()) @db.Uuid
  matchResultId String             @db.Uuid
  title         String
  message       String
  status        NotificationStatus @default(unread)
  sentAt        DateTime           @default(now()) @db.Timestamptz(6)
  readAt        DateTime?          @db.Timestamptz(6)
  createdAt     DateTime           @default(now()) @db.Timestamptz(6)
  matchResult   MatchResult        @relation(fields: [matchResultId], references: [id])

  @@index([status, sentAt], map: "idx_notification_status_sent")
}

model OrderPreset {
  id                String      @id @default(uuid()) @db.Uuid
  matchResultId     String      @db.Uuid
  symbol            String
  side              TradeSide
  suggestedPrice    Decimal     @db.Decimal(18, 8)
  suggestedQuantity Decimal     @db.Decimal(18, 8)
  confidence        Float
  feesEstimate      Decimal?    @db.Decimal(18, 8)
  createdAt         DateTime    @default(now()) @db.Timestamptz(6)
  matchResult       MatchResult @relation(fields: [matchResultId], references: [id])

  @@index([symbol, createdAt], map: "idx_orderpreset_symbol_created")
}

model NotificationLog {
  id               String                @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  noteId           String                @db.Uuid
  marketSnapshotId String                @db.Uuid
  symbol           String
  score            Float
  channel          String
  status           NotificationLogStatus @default(sent)
  reasonSummary    String
  sentAt           DateTime              @default(now()) @db.Timestamptz(6)
  createdAt        DateTime              @default(now()) @db.Timestamptz(6)
  marketSnapshot   MarketSnapshot        @relation("NotificationLogSnapshot", fields: [marketSnapshotId], references: [id])
  note             TradeNote             @relation("NotificationLogNote", fields: [noteId], references: [id])

  @@unique([noteId, marketSnapshotId, channel], map: "uq_notiflog_note_snapshot_channel")
  @@index([symbol, sentAt], map: "idx_notiflog_symbol_sent")
  @@index([noteId, sentAt], map: "idx_notiflog_note_sent")
}

/// 評価ログ
/// NoteEvaluator.evaluate() の結果を永続化し、
/// ノートの有効性分析（勝率・再現性）の基盤データとなる
model EvaluationLog {
  id               String         @id @default(uuid()) @db.Uuid
  /// ノート ID
  noteId           String         @db.Uuid
  /// 市場スナップショット ID
  marketSnapshotId String         @db.Uuid
  /// シンボル（例: BTCUSDT）
  symbol           String
  /// 時間足（例: 15m, 1h）
  timeframe        String
  /// 類似度スコア（0.0〜1.0）
  similarity       Float
  /// 類似度レベル（strong, medium, weak, none）
  level            String
  /// 発火条件を満たしたか
  triggered        Boolean
  /// 使用したベクトル次元数
  vectorDimension  Int
  /// 使用したインジケーターラベル一覧
  usedIndicators   String[]
  /// 診断情報（noteVector, marketVector 等）
  /// 環境変数 SAVE_EVALUATION_DIAGNOSTICS=true で保存
  diagnostics      Json?
  /// 評価実行日時
  evaluatedAt      DateTime       @db.Timestamptz(6)
  /// レコード作成日時
  createdAt        DateTime       @default(now()) @db.Timestamptz(6)
  marketSnapshot   MarketSnapshot @relation("EvaluationLogSnapshot", fields: [marketSnapshotId], references: [id])
  note             TradeNote      @relation("EvaluationLogNote", fields: [noteId], references: [id])

  @@unique([noteId, marketSnapshotId, timeframe], map: "uq_evallog_note_snapshot_timeframe")
  @@index([noteId, evaluatedAt], map: "idx_evallog_note_evaluated")
  @@index([symbol, evaluatedAt], map: "idx_evallog_symbol_evaluated")
  @@index([triggered, evaluatedAt], map: "idx_evallog_triggered_evaluated")
}

/// ヒストリカルデータプリセット
/// ユーザーがアップロードしたCSVから生成されるOHLCVデータセットのメタ情報
/// シンボル×時間足ごとに1プリセット
model DataPreset {
  id          String   @id @default(uuid()) @db.Uuid
  /// シンボル（例: BTCUSD, USDJPY）
  symbol      String
  /// 時間足（例: 15m, 1h, 4h, 1d）
  timeframe   String
  /// データ開始日時（UTC）
  startDate   DateTime @db.Timestamptz(6)
  /// データ終了日時（UTC）
  endDate     DateTime @db.Timestamptz(6)
  /// レコード数
  recordCount Int
  /// プリセット名（表示用、オプション）
  name        String?
  /// 説明
  description String?
  /// 元ファイル名
  sourceFile  String?
  /// 作成日時
  createdAt   DateTime @default(now()) @db.Timestamptz(6)
  /// 更新日時
  updatedAt   DateTime @updatedAt @db.Timestamptz(6)

  @@unique([symbol, timeframe], map: "uq_datapreset_symbol_timeframe")
  @@index([symbol, timeframe], map: "idx_datapreset_symbol_timeframe")
}

/// OHLCV ローソク足データ
/// 将来的に TimescaleDB のハイパーテーブルに変換予定
/// 変換 SQL: SELECT create_hypertable('OHLCVCandle', 'timestamp');
model OHLCVCandle {
  id        String   @id @default(uuid()) @db.Uuid
  /// 銘柄シンボル（例: BTCUSD, EURUSD）
  symbol    String
  /// 時間足（例: 1m, 5m, 15m, 1h, 4h, 1d）
  timeframe String
  /// ローソク足開始時刻（UTC）
  timestamp DateTime @db.Timestamptz(6)
  /// 始値
  open      Decimal  @db.Decimal(18, 8)
  /// 高値
  high      Decimal  @db.Decimal(18, 8)
  /// 安値
  low       Decimal  @db.Decimal(18, 8)
  /// 終値
  close     Decimal  @db.Decimal(18, 8)
  /// 出来高
  volume    Decimal  @db.Decimal(18, 8)
  /// データソース（例: twelvedata, binance）
  source    String?
  /// 作成日時
  createdAt DateTime @default(now()) @db.Timestamptz(6)

  @@unique([symbol, timeframe, timestamp], map: "uq_ohlcv_symbol_timeframe_timestamp")
  @@index([symbol, timeframe, timestamp], map: "idx_ohlcv_symbol_timeframe_timestamp")
  @@index([symbol, timestamp], map: "idx_ohlcv_symbol_timestamp")
}

/// バックテスト執行シミュ用のスプレッド集計バー
/// cTrader の BID/ASK tick から avg/max/p95 spread を時間足単位で集計する
model SpreadBar {
  id        String   @id @default(uuid()) @db.Uuid
  /// 銘柄シンボル（例: XAUUSD, EURUSD）
  symbol    String
  /// 時間足（例: 1m, 5m, 15m, 1h）
  timeframe String
  /// バー開始時刻（UTC）
  timestamp DateTime @db.Timestamptz(6)
  /// 平均スプレッド（価格単位）
  avgSpread Decimal  @db.Decimal(18, 8)
  /// 最大スプレッド（価格単位）
  maxSpread Decimal  @db.Decimal(18, 8)
  /// 95パーセンタイルスプレッド（価格単位）
  p95Spread Decimal  @db.Decimal(18, 8)
  /// 集計元tick数
  tickCount Int      @default(0)
  /// データソース（ctrader, fixed_fallback 等）
  source    String   @default("ctrader")
  /// 作成日時
  createdAt DateTime @default(now()) @db.Timestamptz(6)
  /// 更新日時
  updatedAt DateTime @updatedAt @db.Timestamptz(6)

  @@unique([symbol, timeframe, timestamp], map: "uq_spreadbar_symbol_timeframe_timestamp")
  @@index([symbol, timeframe, timestamp], map: "idx_spreadbar_symbol_tf_ts")
  @@index([symbol, timestamp], map: "idx_spreadbar_symbol_ts")
}

/// Raw JSON 形式のトレードノート保存
/// 技術スタック選定シート ⑧ に基づくハイブリッド保存
model TradeNoteRaw {
  id        String   @id @default(uuid()) @db.Uuid
  /// 関連するトレードノート ID
  noteId    String   @unique @db.Uuid
  /// Raw JSON データ（将来の再評価・再生成用）
  rawData   Json
  /// スキーマバージョン（破壊的変更対応）
  version   Int      @default(1)
  /// 作成日時
  createdAt DateTime @default(now()) @db.Timestamptz(6)
  /// 更新日時
  updatedAt DateTime @updatedAt @db.Timestamptz(6)

  @@index([noteId], map: "idx_tradenoteraw_noteid")
}

/// 再評価ジョブ管理
/// 技術スタック選定シート ⑨ に基づく
model RevaluationJob {
  id             String               @id @default(uuid()) @db.Uuid
  /// ジョブタイプ（note_regenerate, feature_recalculate, ai_summary_regenerate）
  jobType        RevaluationJobType
  /// 対象ノート ID（null の場合は全ノート対象）
  targetNoteId   String?              @db.Uuid
  /// 対象銘柄（null の場合は全銘柄対象）
  targetSymbol   String?
  /// ジョブ状態
  status         RevaluationJobStatus @default(pending)
  /// 処理済み件数
  processedCount Int                  @default(0)
  /// 総件数
  totalCount     Int                  @default(0)
  /// エラーメッセージ
  errorMessage   String?
  /// 開始日時
  startedAt      DateTime?            @db.Timestamptz(6)
  /// 完了日時
  completedAt    DateTime?            @db.Timestamptz(6)
  /// 作成日時
  createdAt      DateTime             @default(now()) @db.Timestamptz(6)
  /// 更新日時
  updatedAt      DateTime             @updatedAt @db.Timestamptz(6)

  @@index([status, createdAt], map: "idx_revaluationjob_status_created")
  @@index([jobType, status], map: "idx_revaluationjob_type_status")
}

/// Web Push 購読情報
model PushSubscription {
  id           String    @id @default(uuid()) @db.Uuid
  /// Push API エンドポイント URL
  endpoint     String    @unique
  /// 暗号化キー（p256dh）
  p256dh       String
  /// 認証シークレット
  auth         String
  /// 有効フラグ
  active       Boolean   @default(true)
  /// 最終プッシュ送信日時
  lastPushedAt DateTime? @db.Timestamptz(6)
  /// 連続失敗回数（リトライ制御用）
  failureCount Int       @default(0)
  /// 作成日時
  createdAt    DateTime  @default(now()) @db.Timestamptz(6)
  /// 更新日時
  updatedAt    DateTime  @updatedAt @db.Timestamptz(6)
  /// ユーザー ID（マルチユーザー対応）
  userId       String    @db.Uuid
  user         User      @relation("UserPushSubscriptions", fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, active], map: "idx_pushsub_user_active")
}

/// Push通知送信ログ
model PushLog {
  id             String        @id @default(uuid()) @db.Uuid
  /// 購読 ID
  subscriptionId String        @db.Uuid
  /// 通知 ID（Notification テーブルとの紐付け）
  notificationId String?       @db.Uuid
  /// 送信ステータス
  status         PushLogStatus @default(pending)
  /// エラーメッセージ
  errorMessage   String?
  /// リトライ回数
  retryCount     Int           @default(0)
  /// 送信日時
  sentAt         DateTime?     @db.Timestamptz(6)
  /// 作成日時
  createdAt      DateTime      @default(now()) @db.Timestamptz(6)

  @@index([subscriptionId, createdAt], map: "idx_pushlog_sub_created")
  @@index([status, createdAt], map: "idx_pushlog_status_created")
}

/// マッチング詳細（一致理由の内訳を保存）
model MatchDetail {
  id            String   @id @default(uuid()) @db.Uuid
  /// マッチ結果 ID
  matchResultId String   @db.Uuid
  /// 特徴量名（例: rsi, macd, trend）
  featureName   String
  /// ノート側の値
  noteValue     Float?
  /// スナップショット側の値
  snapshotValue Float?
  /// この特徴量の一致度（0.0〜1.0）
  similarity    Float
  /// 重み付け係数
  weight        Float    @default(1.0)
  /// 寄与度（similarity × weight）
  contribution  Float
  /// 異常値フラグ（Z-score が ±3σ を超えた場合）
  isAnomaly     Boolean  @default(false)
  /// 異常値の場合の詳細
  anomalyDetail String?
  /// 作成日時
  createdAt     DateTime @default(now()) @db.Timestamptz(6)

  @@index([matchResultId], map: "idx_matchdetail_matchresult")
}

/// ストラテジー（売買戦略の定義）
model Strategy {
  id               String                @id @default(uuid()) @db.Uuid
  /// ストラテジー名
  name             String
  /// 説明
  description      String?
  /// 対象シンボル（USDJPY, EURUSD, XAUUSD 等）
  symbol           String
  /// トレード方向（buy/sell/both）
  side             StrategyDirection
  /// ステータス
  status           StrategyStatus        @default(draft)
  /// 現在のバージョン ID
  currentVersionId String?               @db.Uuid
  /// タグ（検索・分類用）
  tags             String[]              @default([])
  /// 作成日時
  createdAt        DateTime              @default(now()) @db.Timestamptz(6)
  /// 更新日時
  updatedAt        DateTime              @updatedAt @db.Timestamptz(6)
  alert            StrategyAlert?
  backtestRuns     StrategyBacktestRun[]
  monteCarloRuns   MonteCarloRun[]
  strategyNotes    StrategyNote[]
  versions         StrategyVersion[]
  walkForwardRuns  WalkForwardRun[]

  @@index([symbol], map: "idx_strategy_symbol")
  @@index([status], map: "idx_strategy_status")
  @@index([symbol, status], map: "idx_strategy_symbol_status")
}

/// ストラテジーバージョン（変更履歴）
/// 保存時に常に新バージョンを作成し、履歴を保持
model StrategyVersion {
  id              String             @id @default(uuid()) @db.Uuid
  /// 親ストラテジー ID
  strategyId      String             @db.Uuid
  /// バージョン番号（1, 2, 3...）
  versionNumber   Int
  /// 対象シンボル（変更履歴として保持、ロールバック用）
  symbol          String?
  /// トレード方向（変更履歴として保持、ロールバック用）
  side            StrategyDirection?
  /// エントリー条件（JSON: ConditionGroup）
  entryConditions Json
  /// イグジット設定（JSON: ExitSettings）
  exitSettings    Json
  /// エントリータイミング（next_open 等）
  entryTiming     String             @default("next_open")
  /// 変更理由メモ
  changeNote      String?
  /// 作成日時
  createdAt       DateTime           @default(now()) @db.Timestamptz(6)
  strategy        Strategy           @relation(fields: [strategyId], references: [id], onDelete: Cascade)

  @@unique([strategyId, versionNumber], map: "uq_strategyversion_strategy_version")
  @@index([strategyId], map: "idx_strategyversion_strategyid")
}

/// ストラテジーノート（優位性確認済みセットアップ）
/// バックテストで勝ったセットアップを保存し、パターン検出に活用
model StrategyNote {
  id                String             @id @default(uuid()) @db.Uuid
  /// 親ストラテジー ID
  strategyId        String             @db.Uuid
  /// エントリー時刻（バックテストで検出された時刻）
  entryTime         DateTime           @db.Timestamptz(6)
  /// エントリー価格
  entryPrice        Decimal            @db.Decimal(18, 8)
  /// 一致した条件のスナップショット（JSON）
  conditionSnapshot Json
  /// インジケーター値のスナップショット（JSON）
  indicatorValues   Json
  /// バックテスト結果（win/loss/timeout）
  outcome           BacktestOutcome
  /// 損益
  pnl               Decimal?           @db.Decimal(18, 8)
  /// メモ
  notes             String?
  /// 作成日時
  createdAt         DateTime           @default(now()) @db.Timestamptz(6)
  /// 特徴量ベクトル（類似度検索用）
  /// インジケーター定義の Section 12 に基づいて計算
  featureVector     Float[]            @default([])
  /// ノートの状態（draft/active/archived）
  status            StrategyNoteStatus @default(draft)
  /// タグ（カテゴリ、パターン名など）
  tags              String[]           @default([])
  /// 更新日時
  updatedAt         DateTime           @updatedAt @db.Timestamptz(6)
  strategy          Strategy           @relation(fields: [strategyId], references: [id], onDelete: Cascade)

  @@index([strategyId], map: "idx_strategynote_strategyid")
  @@index([strategyId, outcome], map: "idx_strategynote_strategy_outcome")
  @@index([status], map: "idx_strategynote_status")
  @@index([strategyId, status], map: "idx_strategynote_strategy_status")
}

/// ストラテジーバックテスト実行（ストラテジー条件ベース）
model StrategyBacktestRun {
  id         String                  @id @default(uuid()) @db.Uuid
  /// 対象ストラテジー ID
  strategyId String                  @db.Uuid
  /// 使用したバージョン ID
  versionId  String                  @db.Uuid
  /// 銘柄シンボル
  symbol     String
  /// 時間足（例: 15m, 1h, 4h）
  timeframe  String
  /// バックテスト開始日
  startDate  DateTime                @db.Timestamptz(6)
  /// バックテスト終了日
  endDate    DateTime                @db.Timestamptz(6)
  /// ステージ（stage1: 高速スキャン、stage2: 1分足精密検証）
  stage      String                  @default("stage1")
  /// 実行ソース（manual: 手動実行、walkforward: WFテスト、montecarlo: モンテカルロ）
  source     String                  @default("manual")
  /// 実行状態
  status     BacktestStatus          @default(pending)
  /// 作成日時
  createdAt  DateTime                @default(now()) @db.Timestamptz(6)
  /// 更新日時
  updatedAt  DateTime                @updatedAt @db.Timestamptz(6)
  events     StrategyBacktestEvent[]
  result     StrategyBacktestResult?
  strategy   Strategy                @relation(fields: [strategyId], references: [id], onDelete: Cascade)

  @@index([strategyId], map: "idx_strategybacktestrun_strategyid")
  @@index([status, createdAt], map: "idx_strategybacktestrun_status_created")
  @@index([source], map: "idx_strategybacktestrun_source")
}

/// ストラテジーバックテスト集計結果
model StrategyBacktestResult {
  id           String              @id @default(uuid()) @db.Uuid
  /// 対応するバックテスト実行 ID
  runId        String              @unique @db.Uuid
  /// セットアップ出現回数
  setupCount   Int
  /// 勝ちトレード数
  winCount     Int
  /// 負けトレード数
  lossCount    Int
  /// タイムアウト数
  timeoutCount Int
  /// 勝率（0.0〜1.0）
  winRate      Float
  /// プロフィットファクター（総利益/総損失）
  profitFactor Float?
  /// 総利益
  totalProfit  Decimal             @db.Decimal(18, 8)
  /// 総損失
  totalLoss    Decimal             @db.Decimal(18, 8)
  /// 平均損益
  averagePnL   Decimal             @db.Decimal(18, 8)
  /// 期待値
  expectancy   Decimal             @db.Decimal(18, 8)
  /// 最大ドローダウン
  maxDrawdown  Decimal?            @db.Decimal(18, 8)
  /// 計算完了日時
  completedAt  DateTime            @default(now()) @db.Timestamptz(6)
  run          StrategyBacktestRun @relation(fields: [runId], references: [id], onDelete: Cascade)
}

/// ストラテジーバックテスト個別イベント
model StrategyBacktestEvent {
  id              String              @id @default(uuid()) @db.Uuid
  /// 対応するバックテスト実行 ID
  runId           String              @db.Uuid
  /// エントリー時刻
  entryTime       DateTime            @db.Timestamptz(6)
  /// エントリー価格
  entryPrice      Decimal             @db.Decimal(18, 8)
  /// 条件成立時のインジケーター値（JSON）
  indicatorValues Json?
  /// 決済時刻
  exitTime        DateTime?           @db.Timestamptz(6)
  /// 決済価格
  exitPrice       Decimal?            @db.Decimal(18, 8)
  /// 結果
  outcome         BacktestOutcome
  /// 損益
  pnl             Decimal?            @db.Decimal(18, 8)
  /// 作成日時
  createdAt       DateTime            @default(now()) @db.Timestamptz(6)
  run             StrategyBacktestRun @relation(fields: [runId], references: [id], onDelete: Cascade)

  @@index([runId, entryTime], map: "idx_strategybacktestevent_run_entry")
}

/// Critical-4 段階 1: 仮説スクリーニング BT 実行履歴
/// analysis-engine 経由で実行された BT 結果を保存する。
/// EdgeHypothesis.screeningResult.screeningBacktestRunId から参照される。
/// notePayload は BT 入力スナップショット (entry conditions / SL/TP 仕様 / 指標スペック)。
model ScreeningBacktestRun {
  id            String   @id @default(uuid()) @db.Uuid
  /// EdgeHypothesis.id (Side-B 横断のため外部キーは貼らない)
  hypothesisId  String   @db.Uuid
  /// 銘柄シンボル
  symbol        String
  /// 時間足
  timeframe     String
  /// BT 期間開始
  periodStart   DateTime @db.Timestamptz(6)
  /// BT 期間終了
  periodEnd     DateTime @db.Timestamptz(6)
  /// BT 入力スナップショット
  notePayload   Json
  /// BT 結果サマリー (pf / winRate / tradeCount / maxDD / sharpe / returnPct)
  summary       Json
  /// トレード詳細 (各エントリー/エグジットの記録)
  trades        Json
  /// equity curve (任意)
  equity        Json?
  /// BT エンジン名+バージョン (例: 'analysis-engine/backtesting.py@0.6.5')
  engineVersion String
  createdAt     DateTime @default(now()) @db.Timestamptz(6)

  @@index([hypothesisId, createdAt(sort: Desc)], map: "idx_screening_bt_hyp_created")
  @@index([symbol, timeframe], map: "idx_screening_bt_symbol_tf")
}

/// 進化ループの正式 BT 履歴 (Critical-4 段階 4a.4)
///
/// EvolutionLoop top K の analysis-engine 正式 BT 結果を保存する。
/// ScreeningBacktestRun (= EdgeHypothesis 由来の screening 履歴) とは
/// 役割を分離するため別テーブル。進化候補は EdgeHypothesis を持たない
/// ため、識別は generation + candidateId + candidateHash で行う。
///
/// 集計用途:
///   - generation 別の formalBtPassed 率 (親個体プール戦略の効果測定)
///   - failureReason 別の分布 (どのケースで失敗が多いか)
///   - 同 candidateHash の再評価追跡 (DSL ハッシュで重複検出)
model EvolutionBacktestRun {
  id            String   @id @default(uuid()) @db.Uuid
  /// 進化ループ実行単位 ID (1 サイクル = 1 evolutionRunId、cron 起動毎に発番)
  evolutionRunId String  @db.Uuid
  /// 世代番号 (DSL.generation と同値、0 始まり)
  generation    Int
  /// 進化候補の DSL ID (DSL.id と同じ)
  candidateId   String
  /// DSL の構造ハッシュ (同一構造の重複検出 / 再評価追跡用)
  candidateHash String
  /// DSL スナップショット (validation / debug 用、StrategyDSL JSON 全体)
  dslSnapshot   Json
  /// surrogate fitness の合成スコア (= scoreFromValidationSummary 値)
  surrogateScore Float
  /// analysis-engine 正式 BT を通過したか
  formalBtPassed Boolean
  /// 正式 BT メトリクス (pf / winRate / tradeCount)、analysis-engine 成功時のみ非 null
  formalBtMetrics Json?
  /// 失敗時の理由 (HTTP / timeout / PF 未達 / トレード数不足など)、passed=true の場合 null
  formalBtFailureReason String?
  /// BT エンジン識別子 (例: 'analysis-engine')
  engine        String
  /// BT エンジンバージョン (例: 'backtesting.py@0.6.5')
  engineVersion String
  /// Filter Evolution Phase B-1 (2026-05-09): 本格 BT で発生した trade list。
  /// 各要素は { entryTime, side, pnl, outcome }。tradeCount > 0 の候補のみ非空。
  /// 用途:
  ///   - cron 起動を跨いだ Win Rate Lift 計算 (同 evolutionRunId 内の親 trades 参照)
  ///   - 失敗診断 / オフライン分析 (= Phase B-2 で carry state と組み合わせる)
  /// 既存行 (Phase B-1 以前) は NULL のまま、計算側 helper は notComputable で逃げる。
  /// 設計書: docs/review/2026-05-09_agent_loop_diagnosis_and_plan.md §5.B.3
  trades        Json?
  createdAt     DateTime @default(now()) @db.Timestamptz(6)

  @@index([evolutionRunId, generation], map: "idx_evolution_bt_run_gen")
  @@index([candidateHash, createdAt(sort: Desc)], map: "idx_evolution_bt_hash_created")
  @@index([formalBtPassed, createdAt(sort: Desc)], map: "idx_evolution_bt_passed_created")
}

/// Filter Evolution Phase D-1a (2026-05-09): 世代単位の reflection lessons。
///
/// `GenerationReflectionAgent` (= Phase D-1b で実装) が各世代終了直後に出す
/// 「当世代で何が起きたか」の verbal lesson を永続化する。
/// 用途:
///   - 後続世代の mutation/crossover prompt に lesson を流す (= AgentMemory.getGenerationLessons)
///   - PDCA loop の thinking log に世代単位の振り返りを残す (Phase E と組み合わせ)
///   - 観察フェーズで「学習が機能しているか」を定量確認 (= 設計書 §3.3 観測条件 4)
///
/// 設計書: docs/review/2026-05-09_agent_loop_diagnosis_and_plan.md §5.B.1 / §5.D
model GenerationLesson {
  id              String   @id @default(uuid()) @db.Uuid
  /// 当該 lesson を生成した evolutionRunId (= cron 起動毎に発番、debug 用)
  evolutionRunId  String   @db.Uuid
  /// 進化ループ regime (= Reflection 対象世代の regime)
  regime          String
  /// 生成元世代番号 (= multi-gen runner の generationIndex、0-indexed)
  generation      Int
  /// 'breakthrough' / 'stagnation' / 'mutation_decay' / 'novelty_emerged' /
  /// 'regime_shift_detected' / 'filter_efficacy_increased' 等のカテゴリ。
  /// 値域は GenerationReflectionAgent の prompt schema 側で固定。
  category        String
  /// 人間語の lesson (= DESIGN_DOC §1.1 原則 5「人間語に翻訳して記録」)
  lesson          String
  /// supporting metrics (= dsr / lift 等の数値根拠、JSON 形式)
  metrics         Json?
  /// LLM が報告した confidence (0.0-1.0)、未報告時 null
  confidence      Float?
  recordedAt      DateTime @default(now()) @db.Timestamptz(6)

  @@index([evolutionRunId, regime, generation], map: "idx_gen_lesson_run_regime_gen")
  @@index([regime, recordedAt(sort: Desc)], map: "idx_gen_lesson_regime_recorded")
  @@index([category, recordedAt(sort: Desc)], map: "idx_gen_lesson_category_recorded")
}

/// Filter Evolution Phase B-2 (2026-05-09): 進化ループ世代間で引き継ぐ短命 state。
///
/// EvolutionLoop の in-memory cache (tradesByDslId / lastRepairHints /
/// lastRepairBaselines) を 1 行に詰めて永続化し、cron 起動を跨いだ「学ぶ」
/// サイクルを成立させる。各 cron 起動 (= 新規 evolutionRunId) では regime 単位で
/// 最新 carry を読み出して in-memory cache の初期値とする。
///
/// retention は 14 日 (= Phase B-3 で別 cron job が古い行を条件付き DELETE する想定、
/// 具体的には `EvolutionInstanceCarryRepository.deleteOlderThan(14)` を呼ぶ)。
///
/// 設計書: docs/review/2026-05-09_agent_loop_diagnosis_and_plan.md §5.B.2
model EvolutionInstanceCarry {
  id              String   @id @default(uuid()) @db.Uuid
  /// 当該 carry を生成した evolutionRunId (= cron 起動毎に発番、debug 用)
  evolutionRunId  String   @db.Uuid
  /// 進化ループ regime (= 復元時のキー、cron 跨ぎで同 regime の最新 carry を引く)
  regime          String
  /// 生成元世代番号 (= multi-gen runner 内では 1 cron 中に複数 carry が積まれる、最新が読み出される)
  generation      Int
  /// payload shape: { tradesByDslId: Record<dslId, Array<{entryTime, side, pnl, outcome}>>,
  ///                  repairHints: Record<dslId, RepairHint>,
  ///                  repairBaselines: Record<dslId, RepairOutcomeBaseline> }
  /// 詳細は src/backend/repositories/evolutionInstanceCarryRepository.ts の Zod schema 参照。
  payload         Json
  recordedAt      DateTime @default(now()) @db.Timestamptz(6)

  @@index([evolutionRunId, regime, generation], map: "idx_evolution_carry_run_regime_gen")
  @@index([regime, recordedAt(sort: Desc)], map: "idx_evolution_carry_regime_recorded")
  @@index([recordedAt(sort: Desc)], map: "idx_evolution_carry_recorded")
}

/// ストラテジーアラート設定
/// ストラテジー条件成立時のリアルタイム通知設定
model StrategyAlert {
  id              String             @id @default(uuid()) @db.Uuid
  /// 対象ストラテジー ID
  strategyId      String             @unique @db.Uuid
  /// 有効/無効
  enabled         Boolean            @default(true)
  /// ステータス
  status          AlertStatus        @default(enabled)
  /// クールダウン時間（分）- 同一ストラテジーの連続アラート抑制
  cooldownMinutes Int                @default(60)
  /// 通知チャネル
  channels        AlertChannel[]     @default([in_app])
  /// 最小一致スコア（0.0〜1.0）- この閾値以上で通知
  minMatchScore   Float              @default(0.7)
  /// 最終アラート発火日時
  lastTriggeredAt DateTime?          @db.Timestamptz(6)
  /// 作成日時
  createdAt       DateTime           @default(now()) @db.Timestamptz(6)
  /// 更新日時
  updatedAt       DateTime           @updatedAt @db.Timestamptz(6)
  strategy        Strategy           @relation(fields: [strategyId], references: [id], onDelete: Cascade)
  logs            StrategyAlertLog[]

  @@index([enabled, status], map: "idx_strategyalert_enabled_status")
}

/// ストラテジーアラート発火履歴
model StrategyAlertLog {
  id              String        @id @default(uuid()) @db.Uuid
  /// 対象アラート ID
  alertId         String        @db.Uuid
  /// 一致スコア
  matchScore      Float
  /// 条件成立時のインジケーター値（JSON）
  indicatorValues Json
  /// 通知先チャネル
  channel         AlertChannel
  /// 通知成功/失敗
  success         Boolean
  /// エラーメッセージ（失敗時）
  errorMessage    String?
  /// 発火日時
  triggeredAt     DateTime      @default(now()) @db.Timestamptz(6)
  alert           StrategyAlert @relation(fields: [alertId], references: [id], onDelete: Cascade)

  @@index([alertId, triggeredAt], map: "idx_strategyalertlog_alert_triggered")
}

/// ウォークフォワードテスト実行
model WalkForwardRun {
  id              String             @id @default(uuid()) @db.Uuid
  /// 対象ストラテジー ID
  strategyId      String             @db.Uuid
  /// 使用したバージョン ID
  versionId       String             @db.Uuid
  /// テスト種別
  type            WalkForwardType    @default(fixed_split)
  /// 分割数（固定分割の場合）
  splitCount      Int                @default(4)
  /// In-Sample期間（日数）
  inSampleDays    Int
  /// Out-of-Sample期間（日数）
  outOfSampleDays Int
  /// テスト開始日
  startDate       DateTime           @db.Timestamptz(6)
  /// テスト終了日
  endDate         DateTime           @db.Timestamptz(6)
  /// 時間足
  timeframe       String             @default("1h")
  /// 実行状態
  status          BacktestStatus     @default(pending)
  /// 過学習スコア（0.0〜1.0、低いほど良い）
  /// In-Sample勝率とOut-of-Sample勝率の乖離で算出
  overfitScore    Float?
  /// 総合判定（過学習の疑いあり/なし）
  overfitWarning  Boolean?
  /// 作成日時
  createdAt       DateTime           @default(now()) @db.Timestamptz(6)
  /// 更新日時
  updatedAt       DateTime           @updatedAt @db.Timestamptz(6)
  strategy        Strategy           @relation(fields: [strategyId], references: [id], onDelete: Cascade)
  splits          WalkForwardSplit[]

  @@index([strategyId], map: "idx_walkforwardrun_strategyid")
  @@index([status, createdAt], map: "idx_walkforwardrun_status_created")
}

/// ウォークフォワードテスト分割結果
model WalkForwardSplit {
  id                      String         @id @default(uuid()) @db.Uuid
  /// 対応するウォークフォワード実行 ID
  runId                   String         @db.Uuid
  /// 分割番号（1, 2, 3...）
  splitNumber             Int
  /// In-Sample開始日
  inSampleStart           DateTime       @db.Timestamptz(6)
  /// In-Sample終了日
  inSampleEnd             DateTime       @db.Timestamptz(6)
  /// Out-of-Sample開始日
  outOfSampleStart        DateTime       @db.Timestamptz(6)
  /// Out-of-Sample終了日
  outOfSampleEnd          DateTime       @db.Timestamptz(6)
  /// In-Sample勝率
  inSampleWinRate         Float
  /// In-Sampleトレード数
  inSampleTradeCount      Int
  /// In-SampleプロフィットファクターInt
  inSampleProfitFactor    Float?
  /// Out-of-Sample勝率
  outOfSampleWinRate      Float
  /// Out-of-Sampleトレード数
  outOfSampleTradeCount   Int
  /// Out-of-Sampleプロフィットファクター
  outOfSampleProfitFactor Float?
  /// 勝率の乖離（In - Out）
  winRateDiff             Float
  /// 作成日時
  createdAt               DateTime       @default(now()) @db.Timestamptz(6)
  run                     WalkForwardRun @relation(fields: [runId], references: [id], onDelete: Cascade)

  @@unique([runId, splitNumber], map: "uq_walkforwardsplit_run_number")
  @@index([runId], map: "idx_walkforwardsplit_runid")
}

/// モンテカルロシミュレーション実行履歴
model MonteCarloRun {
  id                        String   @id @default(uuid()) @db.Uuid
  /// 対象ストラテジー ID
  strategyId                String   @db.Uuid
  /// 参照バックテスト実行 ID（オプション）
  backtestRunId             String?  @db.Uuid
  /// シミュレーション回数
  iterations                Int      @default(100)
  /// シード値（再現性用）
  seed                      Int?
  /// 時間足
  timeframe                 String   @default("1h")
  /// 期待勝率（実際のバックテスト結果）
  expectedWinRate           Float
  /// 期待PF（実際のバックテスト結果）
  expectedProfitFactor      Float?
  /// シミュレーション平均勝率
  simulatedMeanWinRate      Float
  /// シミュレーション平均PF
  simulatedMeanProfitFactor Float?
  /// 勝率パーセンタイル（0-100）
  winRatePercentile         Float
  /// PFパーセンタイル（0-100）
  profitFactorPercentile    Float?
  /// DDパーセンタイル（0-100）
  maxDrawdownPercentile     Float?
  /// 総利益パーセンタイル（0-100）
  totalProfitPercentile     Float?
  /// 5%タイル勝率
  winRate5thPercentile      Float?
  /// 95%タイル勝率
  winRate95thPercentile     Float?
  /// 作成日時
  createdAt                 DateTime @default(now()) @db.Timestamptz(6)
  strategy                  Strategy @relation(fields: [strategyId], references: [id], onDelete: Cascade)

  @@index([strategyId], map: "idx_montecarlorun_strategyid")
  @@index([createdAt], map: "idx_montecarlorun_created")
}

/// ユーザーロール
enum UserRole {
  /// 一般ユーザー
  user
  /// 管理者
  admin
}

/// ノートの承認状態
enum NoteStatus {
  draft
  active
  archived
}

enum TradeSide {
  buy
  sell
}

/// ストラテジー用の方向（両建てを許容）
enum StrategyDirection {
  buy
  sell
  both
}

enum NotificationStatus {
  unread
  read
  deleted
}

enum NotificationLogStatus {
  sent
  skipped
  failed
}

enum RevaluationJobType {
  note_regenerate
  feature_recalculate
  ai_summary_regenerate
  full_reprocess
}

enum RevaluationJobStatus {
  pending
  running
  completed
  failed
  cancelled
}

enum BacktestStatus {
  pending
  running
  completed
  failed
}

enum BacktestOutcome {
  win
  loss
  timeout
}

/// ストラテジーノートの状態
enum StrategyNoteStatus {
  /// 下書き（作成直後）
  draft
  /// アクティブ（類似度検索対象）
  active
  /// アーカイブ（検索対象外）
  archived
}

enum PushLogStatus {
  pending
  sent
  failed
  retrying
}

/// ストラテジーステータス
enum StrategyStatus {
  draft
  active
  archived
}

/// アラート通知チャネル
enum AlertChannel {
  /// アプリ内通知
  in_app
  /// Web Push通知
  web_push
}

/// アラートステータス
enum AlertStatus {
  /// 有効
  enabled
  /// 無効
  disabled
  /// 一時停止（クールダウン中）
  paused
}

/// ウォークフォワードテスト種別
enum WalkForwardType {
  /// 固定分割（N分割）
  fixed_split
  /// ローリングウィンドウ（将来拡張用）
  rolling_window
}

// ============================================================
// フェーズ8: 複数ノート運用UX - 同時ヒット制御
// ============================================================

/// 通知バッチ設定（同時ヒット制御のグローバル設定）
/// システム全体で1レコードのみ保持（シングルトン）
model NotificationBatchConfig {
  id              String   @id @default(uuid()) @db.Uuid
  /// 同時に送信する最大通知数（デフォルト3）
  maxSimultaneous Int      @default(3)
  /// シンボル別にグループ化するか（trueの場合、シンボルごとにmaxSimultaneous適用）
  groupBySymbol   Boolean  @default(true)
  /// クールダウン時間（分）- 同一ノートへの連続通知を抑制
  cooldownMinutes Int      @default(15)
  /// 作成日時
  createdAt       DateTime @default(now()) @db.Timestamptz(6)
  /// 更新日時
  updatedAt       DateTime @updatedAt @db.Timestamptz(6)
}

/// 通知スキップログ（同時ヒット制御でスキップされた通知の記録）
/// デバッグ・分析用。なぜ通知されなかったかを追跡可能にする
model NotificationSkipLog {
  id            String                 @id @default(uuid()) @db.Uuid
  /// スキップされた TradeNote ID
  noteId        String                 @db.Uuid
  /// マッチ結果 ID（任意）
  matchResultId String?                @db.Uuid
  /// スキップ理由
  reason        NotificationSkipReason
  /// 詳細情報（JSON形式で任意のメタデータ）
  details       Json?
  /// スキップ発生日時
  skippedAt     DateTime               @default(now()) @db.Timestamptz(6)

  note        TradeNote    @relation("NotificationSkipLogNote", fields: [noteId], references: [id])
  matchResult MatchResult? @relation("NotificationSkipLogMatch", fields: [matchResultId], references: [id])

  @@index([noteId], map: "idx_notification_skip_note")
  @@index([skippedAt], map: "idx_notification_skip_at")
  @@index([reason], map: "idx_notification_skip_reason")
}

/// 通知スキップ理由
enum NotificationSkipReason {
  /// 同時ヒット数上限超過（優先度が低いためスキップ）
  max_simultaneous_exceeded
  /// クールダウン中（同一ノートへの連続通知抑制）
  cooldown_active
  /// ノートが無効化されている
  note_disabled
  /// ノートが一時停止中
  note_paused
  /// 優先度が低い（同一シンボル内で優先度負け）
  lower_priority
}

// ============================================================
// Side-B: TradeAssistant-AI
// ============================================================

/// 市場リサーチ（AI生成の中間データ）
/// Research AIが生成し、キャッシュとしてDBに保存
/// 
/// 設計変更（シンプル化）:
/// - Research AIは12次元特徴量のみ出力
/// - トレンド解釈、価格レベルはPlan AIの責務
model MarketResearch {
  id        String @id @default(uuid()) @db.Uuid
  /// 対象シンボル（例: XAUUSD）
  symbol    String
  /// 分析時間軸（multi: マルチタイムフレーム）
  timeframe String @default("multi")

  // ===========================================
  // Research AIの出力（シンプル化）
  // ===========================================

  /// 12次元特徴量ベクトル（JSONB）
  /// Research AIの唯一の出力
  featureVector Json

  /// OHLCVスナップショット（JSONB）
  /// Plan AI呼び出し時に参照するための価格データキャッシュ
  /// 旧名: rawIndicators
  ohlcvSnapshot Json?

  // ===========================================
  // メタ情報
  // ===========================================

  /// 使用AIモデル（例: gpt-4o-mini）
  aiModel    String
  /// トークン使用量
  tokenUsage Int?

  // 有効期限管理
  /// 有効期限（デフォルト4時間後）
  expiresAt DateTime @db.Timestamptz(6)
  /// 作成日時
  createdAt DateTime @default(now()) @db.Timestamptz(6)

  // リレーション
  tradePlans AITradePlan[]

  @@index([symbol], map: "idx_market_research_symbol")
  @@index([createdAt(sort: Desc)], map: "idx_market_research_created")
  @@index([expiresAt], map: "idx_market_research_expires")
}

/// AIトレードプラン（Plan AIが生成）
model AITradePlan {
  id         String   @id @default(uuid()) @db.Uuid
  /// 参照するリサーチID
  researchId String   @db.Uuid
  /// 対象日（YYYY-MM-DD）
  targetDate DateTime @db.Date
  /// 対象シンボル
  symbol     String

  // 市場分析
  /// 市場分析結果（JSONB: regime, trendDirection, volatility, keyLevels, summary）
  marketAnalysis Json
  /// トレードシナリオ配列（JSONB）
  scenarios      Json

  // メタ情報
  /// 全体信頼度（0-100）
  overallConfidence Int?
  /// 警告事項
  warnings          String[]
  /// 使用AIモデル（例: gpt-4o）
  aiModel           String?
  /// トークン使用量
  tokenUsage        Int?

  /// 作成日時
  createdAt DateTime @default(now()) @db.Timestamptz(6)

  // リレーション
  research      MarketResearch @relation(fields: [researchId], references: [id])
  virtualTrades VirtualTrade[]
  aiNotes       AITradeNote[]

  @@unique([targetDate, symbol], map: "uq_ai_trade_plan_date_symbol")
  @@index([targetDate], map: "idx_ai_trade_plan_date")
  @@index([symbol], map: "idx_ai_trade_plan_symbol")
}

/// 仮想トレード（Phase B用）
/// AIプランに基づく仮想的なトレード実行記録
model VirtualTrade {
  id         String @id @default(uuid()) @db.Uuid
  /// 参照するプランID
  planId     String @db.Uuid
  /// シナリオID（プラン内のシナリオを特定）
  scenarioId String
  /// 対象シンボル
  symbol     String

  // ポジション情報
  /// 方向（long/short）
  direction String
  /// ステータス
  status    VirtualTradeStatus @default(pending)

  // エントリー
  /// 予定エントリー価格
  plannedEntry Decimal   @db.Decimal(18, 8)
  /// 実際のエントリー価格
  actualEntry  Decimal?  @db.Decimal(18, 8)
  /// エントリー日時
  enteredAt    DateTime? @db.Timestamptz(6)

  // 決済
  /// SL価格
  stopLoss   Decimal   @db.Decimal(18, 8)
  /// TP価格
  takeProfit Decimal   @db.Decimal(18, 8)
  /// 決済価格
  exitPrice  Decimal?  @db.Decimal(18, 8)
  /// 決済日時
  exitedAt   DateTime? @db.Timestamptz(6)
  /// 決済理由
  exitReason String?

  // 結果
  /// 損益（pips）
  pnlPips   Decimal? @db.Decimal(18, 8)
  /// 損益（金額、仮想）
  pnlAmount Decimal? @db.Decimal(18, 8)

  /// 作成日時
  createdAt DateTime @default(now()) @db.Timestamptz(6)
  /// 更新日時
  updatedAt DateTime @updatedAt @db.Timestamptz(6)

  // リレーション
  plan   AITradePlan  @relation(fields: [planId], references: [id])
  aiNote AITradeNote?

  @@index([planId], map: "idx_virtual_trade_plan")
  @@index([status], map: "idx_virtual_trade_status")
  @@index([symbol], map: "idx_virtual_trade_symbol")
}

/// 仮想トレードステータス
enum VirtualTradeStatus {
  /// 待機中（エントリー条件待ち）
  pending
  /// オープン（ポジション保有中）
  open
  /// クローズ（決済済み）
  closed
  /// キャンセル（条件未達でキャンセル）
  cancelled
  /// 期限切れ
  expired
  /// 無効化（無効化条件に該当）
  invalidated
}

/// 仮想ポートフォリオ（Phase B用）
/// AIの仮想トレード統計を管理
model VirtualPortfolio {
  id   String @id @default(uuid()) @db.Uuid
  /// 名前（例: "Default", "Conservative"）
  name String @default("Default")

  // 資金管理
  /// 初期仮想資金
  initialBalance Decimal @default(100000) @db.Decimal(18, 2)
  /// 現在の仮想残高
  currentBalance Decimal @default(100000) @db.Decimal(18, 2)

  // 統計情報（JSON）
  /// 統計サマリー（totalTrades, winRate, profitFactor, maxDrawdown等）
  stats Json @default("{}")

  // 設定
  /// 同時保有上限
  maxOpenPositions    Int     @default(3)
  /// 1トレードあたりのリスク率（%）
  riskPercentPerTrade Decimal @default(1.0) @db.Decimal(5, 2)
  /// スプレッド考慮フラグ
  enableSpread        Boolean @default(false)
  /// 想定スプレッド（pips）
  spreadPips          Decimal @default(2.0) @db.Decimal(5, 2)

  /// 作成日時
  createdAt DateTime @default(now()) @db.Timestamptz(6)
  /// 更新日時
  updatedAt DateTime @updatedAt @db.Timestamptz(6)

  @@index([name], map: "idx_virtual_portfolio_name")
}

/// AIトレードノート（Phase C）
/// 仮想トレードの結果をAIが自動分析して記録
model AITradeNote {
  id             String @id @default(uuid()) @db.Uuid
  /// 仮想トレードID
  virtualTradeId String @unique @db.Uuid
  /// 元のプランID
  planId         String @db.Uuid

  // 基本情報
  /// 日付（YYYY-MM-DD）
  date      DateTime @db.Date
  /// シンボル
  symbol    String
  /// 方向（long/short）
  direction String

  // 結果
  /// 勝敗（win/loss/breakeven）
  outcome         String
  /// 損益（pips）
  pnlPips         Decimal @db.Decimal(10, 2)
  /// 損益（%）
  pnlPercentage   Decimal @db.Decimal(10, 4)
  /// 実際のRR比
  rrActual        Decimal @db.Decimal(5, 2)
  /// 保有時間（分）
  holdingDuration Int

  // 分析（JSONB）
  /// エントリー分析
  entryAnalysis        Json
  /// 決済分析
  exitAnalysis         Json
  /// プラン評価
  planEvaluation       Json
  /// 市場振り返り
  marketReview         Json
  /// 学び
  learnings            Json
  /// 類似パターン
  similarPatterns      Json?
  /// レンズ特徴量スナップショット（Phase 1: 並列レンズ基盤）
  /// トレード時点での全レンズ出力を SerializedLensFeatureSnapshot 形式で保持
  lensSnapshot         Json?
  /// 関連するエッジ仮説ID（Phase 4a: ReflectionAI が recordObservation した仮説）
  relatedHypothesisIds String[] @default([])
  /// 対応する Side-A TradeNote の ID（Phase 4b: ブリッジ層で同時生成）
  tradeNoteId          String?  @db.Uuid

  /// 使用したAIモデル
  aiModel String

  /// 作成日時
  createdAt DateTime @default(now()) @db.Timestamptz(6)

  // リレーション
  virtualTrade VirtualTrade @relation(fields: [virtualTradeId], references: [id])
  plan         AITradePlan  @relation(fields: [planId], references: [id])

  @@index([date], map: "idx_ai_trade_note_date")
  @@index([outcome], map: "idx_ai_trade_note_outcome")
  @@index([symbol], map: "idx_ai_trade_note_symbol")
}

/// AIノートサマリー（期間集計）
model AINoteSummary {
  id        String   @id @default(uuid()) @db.Uuid
  /// 期間タイプ（daily/weekly/monthly）
  period    String
  /// 開始日
  startDate DateTime @db.Date
  /// 終了日
  endDate   DateTime @db.Date

  // 統計・分析・総括（JSONB）
  /// 統計データ
  statistics Json
  /// 分析結果
  analysis   Json
  /// 総括
  summary    Json

  /// 作成日時
  createdAt DateTime @default(now()) @db.Timestamptz(6)

  @@unique([period, startDate, endDate], map: "uq_ai_note_summary_period")
  @@index([period, startDate], map: "idx_ai_note_summary_period")
}

/// cTrader OAuth トークン
/// ユーザーのcTraderアカウント情報を管理（1ユーザー : N アカウント）
model CTraderToken {
  id              String    @id @default(uuid()) @db.Uuid
  /// ユーザーID（外部キー）
  userId          String    @db.Uuid
  /// cTrader アカウントID（複数アカウント対応用）
  accountId       String    @unique
  /// アクセストークン（暗号化推奨）
  accessToken     String
  /// リフレッシュトークン（暗号化推奨）
  refreshToken    String
  /// アクセストークン有効期限
  expiresAt       DateTime  @db.Timestamptz(6)
  /// トークンスコープ
  scope           String?
  /// 最終接続日時
  lastConnectedAt DateTime? @db.Timestamptz(6)
  /// 作成日時
  createdAt       DateTime  @default(now()) @db.Timestamptz(6)
  /// 更新日時
  updatedAt       DateTime  @updatedAt @db.Timestamptz(6)
  user            User      @relation("UserCTraderTokens", fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId], map: "idx_ctradertoken_userid")
  @@index([expiresAt], map: "idx_ctrader_token_expires")
}

// ============================================================
// リアルタイム Tick データ
// ============================================================

/// Tick データ（cTrader WebSocket から受信）
/// リアルタイムチャート用の最小単位データ
/// 高頻度書き込み対象のため、TimescaleDB ハイパーテーブル化推奨
model TickData {
  id        String   @id @default(uuid()) @db.Uuid
  /// シンボル（例: XAUUSD, USDJPY）
  symbol    String
  /// Tick 受信時刻（ミリ秒精度）
  timestamp DateTime @db.Timestamptz(6)
  /// Bid 価格
  bid       Decimal  @db.Decimal(18, 8)
  /// Ask 価格
  ask       Decimal  @db.Decimal(18, 8)
  /// Mid 価格（(bid + ask) / 2）
  mid       Decimal  @db.Decimal(18, 8)
  /// スプレッド（ask - bid）
  spread    Decimal  @db.Decimal(18, 8)
  /// 出来高（Tick 単位、cTrader から取得可能な場合）
  volume    Decimal? @db.Decimal(18, 8)
  /// データソース（ctrader, simulated 等）
  source    String   @default("ctrader")
  /// 作成日時
  createdAt DateTime @default(now()) @db.Timestamptz(6)

  @@index([symbol, timestamp], map: "idx_tick_symbol_timestamp")
  @@index([timestamp], map: "idx_tick_timestamp")
}

/// リアルタイム OHLCV バー（Tick から生成）
/// RollingWindowService で集約された確定バー
model RealtimeOHLCV {
  id        String   @id @default(uuid()) @db.Uuid
  /// シンボル
  symbol    String
  /// 時間足（1s, 5s, 10s, 30s, 1m 等）
  timeframe String
  /// バー開始時刻
  timestamp DateTime @db.Timestamptz(6)
  /// 始値
  open      Decimal  @db.Decimal(18, 8)
  /// 高値
  high      Decimal  @db.Decimal(18, 8)
  /// 安値
  low       Decimal  @db.Decimal(18, 8)
  /// 終値
  close     Decimal  @db.Decimal(18, 8)
  /// 出来高
  volume    Decimal  @db.Decimal(18, 8)
  /// Tick 数（このバーに含まれる Tick の数）
  tickCount Int      @default(0)
  /// 作成日時
  createdAt DateTime @default(now()) @db.Timestamptz(6)

  @@unique([symbol, timeframe, timestamp], map: "uq_realtime_ohlcv")
  @@index([symbol, timeframe, timestamp], map: "idx_realtime_ohlcv_symbol_tf_ts")
}

// ============================================================
// ストラテジー横断分析（Phase Next）
// ============================================================

/// ストラテジー比較セッション
/// 複数ストラテジーの比較分析を管理
model StrategyComparisonSession {
  id          String   @id @default(uuid()) @db.Uuid
  /// セッション名（例: "2025年Q4比較"）
  name        String
  /// 比較対象ストラテジーID配列
  strategyIds String[] @default([])
  /// 分析期間開始日
  startDate   DateTime @db.Date
  /// 分析期間終了日
  endDate     DateTime @db.Date
  /// 時間足
  timeframe   String   @default("1h")
  /// 作成日時
  createdAt   DateTime @default(now()) @db.Timestamptz(6)
  /// 更新日時
  updatedAt   DateTime @updatedAt @db.Timestamptz(6)

  // リレーション
  results       StrategyComparisonResult[]
  correlations  StrategyCorrelation[]
  optimizations PortfolioOptimization[]

  @@index([createdAt(sort: Desc)], map: "idx_comparison_session_created")
}

/// ストラテジー比較結果
/// 各ストラテジーの期間別パフォーマンス
model StrategyComparisonResult {
  id         String @id @default(uuid()) @db.Uuid
  /// セッションID
  sessionId  String @db.Uuid
  /// ストラテジーID
  strategyId String @db.Uuid

  // パフォーマンス指標
  /// トレード数
  totalTrades  Int
  /// 勝率（0-1）
  winRate      Float
  /// プロフィットファクター
  profitFactor Float?
  /// 純損益
  netProfit    Decimal @db.Decimal(18, 8)
  /// 最大ドローダウン
  maxDrawdown  Decimal @db.Decimal(18, 8)
  /// シャープレシオ（年率換算）
  sharpeRatio  Float?
  /// ソルティノレシオ（下方リスクのみ考慮）
  sortinoRatio Float?
  /// カルマーレシオ（年間リターン/最大DD）
  calmarRatio  Float?

  // 時系列データ（JSONB）
  /// 日次リターン配列
  dailyReturns Json?
  /// エクイティカーブ（{date, equity}[]）
  equityCurve  Json?

  /// 作成日時
  createdAt DateTime @default(now()) @db.Timestamptz(6)

  // リレーション
  session StrategyComparisonSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@unique([sessionId, strategyId], map: "uq_comparison_result_session_strategy")
  @@index([sessionId], map: "idx_comparison_result_session")
}

/// ストラテジー相関
/// ストラテジーペア間の相関係数
model StrategyCorrelation {
  id          String @id @default(uuid()) @db.Uuid
  /// セッションID
  sessionId   String @db.Uuid
  /// ストラテジーA ID
  strategyAId String @db.Uuid
  /// ストラテジーB ID
  strategyBId String @db.Uuid

  // 相関指標
  /// ピアソン相関係数（-1〜1）
  pearsonCorr  Float
  /// スピアマン順位相関係数
  spearmanCorr Float?
  /// 同時勝率（両方勝つ確率）
  coWinRate    Float?
  /// 同時負け率（両方負ける確率）
  coLossRate   Float?

  /// 作成日時
  createdAt DateTime @default(now()) @db.Timestamptz(6)

  // リレーション
  session StrategyComparisonSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@unique([sessionId, strategyAId, strategyBId], map: "uq_correlation_session_pair")
  @@index([sessionId], map: "idx_correlation_session")
}

/// ポートフォリオ最適化結果
model PortfolioOptimization {
  id        String             @id @default(uuid()) @db.Uuid
  /// セッションID
  sessionId String             @db.Uuid
  /// 最適化手法
  method    OptimizationMethod

  // 最適化結果
  /// 各ストラテジーの配分比率（JSONB: {strategyId: weight}[]）
  weights           Json
  /// 期待リターン（年率）
  expectedReturn    Float
  /// 期待リスク（標準偏差、年率）
  expectedRisk      Float
  /// シャープレシオ
  sharpeRatio       Float?
  /// 効率的フロンティア（JSONB: {risk, return}[]）
  efficientFrontier Json?

  /// 作成日時
  createdAt DateTime @default(now()) @db.Timestamptz(6)

  // リレーション
  session StrategyComparisonSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@index([sessionId], map: "idx_optimization_session")
}

/// ポートフォリオ最適化手法
enum OptimizationMethod {
  /// 平均分散最適化（マーコビッツ）
  mean_variance
  /// リスクパリティ（等リスク寄与）
  risk_parity
  /// 等ウェイト
  equal_weight
  /// 最小分散
  minimum_variance
  /// 最大シャープレシオ
  max_sharpe
}

// ============================================================
// Side-B Phase 4a: エッジ台帳（EdgeHypothesis / EdgeLedger）
// ============================================================

/// 検証可能な仮説の台帳エントリ
///
/// 設計思想:
/// - LLM が構造発見で出した仮説を、機械判定可能な条件付きで保存する
/// - status: unverified → testing → confirmed / rejected / stale
/// - 昇格判定（Phase 4b の EdgeValidator）は次フェーズで実装
/// - 観測実績は累積し、劣化を検出する
model EdgeHypothesis {
  id String @id @default(uuid()) @db.Uuid

  // 記述
  /// 人間可読の仮説文
  statement         String
  /// カテゴリ（time/level/event/correlation/positioning/volatility/structure/other）
  category          String
  /// 機械判定条件（MachineReadableCondition[] を JSONB で保存）
  conditions        Json
  /// 期待される方向（long/short/either）
  expectedDirection String

  // ライフサイクル
  /// ステータス（unverified/testing/confirmed/stale/rejected）
  status          String   @default("unverified")
  /// ステータス変更日時
  statusUpdatedAt DateTime @default(now()) @db.Timestamptz(6)
  /// ステータス変更の直近理由（rejected/stale時に記録）
  statusNote      String?

  // 対象
  /// 適用対象シンボル
  symbols    String[] @default([])
  /// 適用対象時間足
  timeframes String[] @default([])

  // 実績
  observationCount Int     @default(0)
  winCount         Int     @default(0)
  lossCount        Int     @default(0)
  breakevenCount   Int     @default(0)
  /// 累計 pnl pips
  totalPnlPips     Decimal @default(0) @db.Decimal(12, 2)
  /// 平均 RR 比
  avgRR            Decimal @default(0) @db.Decimal(6, 3)

  // 検証履歴（Phase 4b で EdgeValidator が埋める）
  backtestResults    Json?
  walkForwardResults Json?

  // メタデータ
  /// 生成元（ai_generated/reflection/user_input/backtest/discovery）
  source        String
  /// レンズごとの重要度推定（0-1）
  lensRelevance Json?

  // Phase 4b: ブリッジ層
  /// デフォルトのリスク管理設定（DefaultRiskManagement 形式）
  defaultRiskManagement    Json?
  /// この仮説から materialize された Side-A TradeNote の ID 群
  materializedTradeNoteIds String[] @default([])
  /// 無効化条件（MachineReadableCondition[] 形式）
  invalidationConditions   Json?
  /// confirmed 昇格時の LLM 解釈テキスト
  confirmationNote         String?
  /// Phase 4b 縮小版: 直近のスクリーニング結果（ScreeningResult 形式）
  screeningResult          Json?

  // Phase 4c: 本格検証レポート
  /// 4ツール統合の検証レポート（ConsolidatedValidationReport 形式）
  fullValidationReport       Json?
  /// confirmed 時の LLM 解釈
  confirmationInterpretation String?
  /// rejected 時の LLM 解釈
  rejectionInterpretation    String?
  /// LLM による改善提案
  actionableInsights         String[] @default([])

  // タイムスタンプ
  firstObservedAt DateTime  @default(now()) @db.Timestamptz(6)
  lastObservedAt  DateTime  @default(now()) @db.Timestamptz(6)
  lastTestedAt    DateTime? @db.Timestamptz(6)
  createdAt       DateTime  @default(now()) @db.Timestamptz(6)
  updatedAt       DateTime  @updatedAt

  // 関連
  /// 派生元の親仮説ID
  parentIds      String[] @default([])
  /// 関連する AITradeNote ID
  relatedNoteIds String[] @default([])

  @@index([status], map: "idx_edge_hypothesis_status")
  @@index([category], map: "idx_edge_hypothesis_category")
  @@index([source], map: "idx_edge_hypothesis_source")
  @@index([createdAt(sort: Desc)], map: "idx_edge_hypothesis_created")
}

/// Phase 6: プロンプトバージョン台帳
/// 各エージェントのシステムプロンプトをバージョン管理し、
/// 月次プロンプト進化 / A/B テスト / 人間承認フローの基盤として利用する。
/// agentName は列挙型で固定しない(将来 MetaEvolutionAgent が新エージェントを追加する前提)。
model PromptVersion {
  id              String    @id @default(uuid()) @db.Uuid
  /// 対象エージェント名(例: 'hypothesis_generator', 'trend_specialist')
  agentName       String
  /// セマンティックバージョン or タイムスタンプベースの識別子
  version         String
  /// プロンプト本文(マクロプレースホルダー {{CORE_TRADING_RULES}} 等を含むことがある)
  content         String
  /// 変異元のプロンプト ID(PromptMutationAgent / MetaEvolutionAgent が設定)
  parentVersionId String?   @db.Uuid
  /// 作成者(human/mutation/meta_evolution)
  createdBy       String
  /// ステータス(active/experimental/deprecated/rejected)
  /// active は 1 エージェント 1 件(アプリケーション層で保証)
  status          String    @default("experimental")
  /// 実験メモ(変異意図、改善狙いなど)
  notes           String?
  /// このプロンプトで呼び出された回数
  usageCount      Int       @default(0)
  /// 成功と判定された回数(スコアリング関数の解釈はエージェント依存)
  successCount    Int       @default(0)
  /// 直近スコアの単純平均(recordUsage 時に逐次更新)
  avgScore        Float     @default(0)
  /// 最後に使用された時刻
  lastUsedAt      DateTime? @db.Timestamptz(6)
  /// 人間が承認した時刻(experimental → active 昇格時に記録)
  approvedAt      DateTime? @db.Timestamptz(6)
  /// 承認者識別子(CLI ユーザー名など)
  approvedBy      String?
  createdAt       DateTime  @default(now()) @db.Timestamptz(6)
  updatedAt       DateTime  @updatedAt

  @@unique([agentName, version], map: "uq_prompt_version_agent_version")
  @@index([agentName, status], map: "idx_prompt_version_agent_status")
  @@index([status], map: "idx_prompt_version_status")
  @@index([createdAt(sort: Desc)], map: "idx_prompt_version_created")
}

/// Phase 6: プロンプト A/B テスト結果
/// 同一入力を複数バリアントで実行した結果を記録する。
/// 勝者判定は統計処理(アプリ層)に委ねる。
model PromptAbTestResult {
  id              String   @id @default(uuid()) @db.Uuid
  /// 対象エージェント名
  agentName       String
  /// 比較されたバリアント(PromptVersion.id 配列を JSON 保存)
  variantIds      Json
  /// 各バリアントの結果(output/score/durationMs/promptVersionId 配列)
  variantResults  Json
  /// 勝者バリアントの PromptVersion.id(有意差なしなら null)
  winnerVersionId String?  @db.Uuid
  /// 入力ダイジェスト(同一入力かどうかのマーキング用、実体は別管理)
  inputDigest     String?
  testedAt        DateTime @default(now()) @db.Timestamptz(6)

  @@index([agentName, testedAt(sort: Desc)], map: "idx_prompt_abtest_agent_tested")
}

/// Phase 6: MetaEvolutionAgent の再編成提案履歴
/// 手動トリガーで生成された提案と、人間承認 / 実行ログを保持する。
model AgentRestructureProposal {
  id              String    @id @default(uuid()) @db.Uuid
  /// 提案内容(分析結果 + proposals 配列、AgentRestructureProposal 型の JSON)
  proposal        Json
  /// LLM が付けた全体確信度(0-1)
  confidence      Float
  /// 実行ステータス(pending/approved/rejected/executed)
  status          String    @default("pending")
  /// 承認者(CLI ユーザー名など、approved/rejected/executed 時に設定)
  approvedBy      String?
  approvedAt      DateTime? @db.Timestamptz(6)
  /// 実行結果(applied / skipped を含む JSON、executed 時のみ)
  executionResult Json?
  executedAt      DateTime? @db.Timestamptz(6)
  /// 承認メモ
  approvalNotes   String?
  proposedAt      DateTime  @default(now()) @db.Timestamptz(6)
  updatedAt       DateTime  @updatedAt

  @@index([status, proposedAt(sort: Desc)], map: "idx_agent_restructure_status_proposed")
}
</file>

</files>
