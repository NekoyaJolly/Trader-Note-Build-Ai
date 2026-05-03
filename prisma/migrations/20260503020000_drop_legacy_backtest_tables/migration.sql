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
