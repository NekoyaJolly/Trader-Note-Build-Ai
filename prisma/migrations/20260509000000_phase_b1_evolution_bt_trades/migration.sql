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
