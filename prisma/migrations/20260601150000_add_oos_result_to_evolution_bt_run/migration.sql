-- AlterTable: EvolutionBacktestRun に OOS-aware 昇格判定の観測結果 oosResult を追加する。
-- 背景: OOS/WF 検証は計算されていたが補助 summary として並列出力されるだけで、候補ごとに永続化
--       されておらず UI/API に出ていなかった（= in-sample 合格のみが「合格」として見えていた）。
-- { confirmed, finalStage, oosStatus, oosPf, oosWinRate } を JSON で保持。
-- confirmed=true は in-sample 合格に加え OOS/WF も通過した「OOS確証」候補。
-- nullable のため既存行・OOS未評価は NULL（後方互換）。formalBtPassed の意味論は変更しない。
ALTER TABLE "EvolutionBacktestRun" ADD COLUMN "oosResult" JSONB;
