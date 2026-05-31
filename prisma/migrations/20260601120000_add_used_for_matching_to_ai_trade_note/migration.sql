-- AlterTable: AITradeNote に本番運用フラグ usedForMatching を追加する。
-- 背景: ノート全体は履歴として残しつつ、その中から手動で選別した「良いトレード」だけを
--       実行時のライブ市場入力との類似度判定（cross/cron 照合）の対象に限定したい。
-- 既定 false のため既存行はすべて未選別（= 照合対象外）となり後方互換（backfill はしない）。
-- 一覧表示・統計集計は本フラグで絞らず従来どおり全ノートを対象とする。
ALTER TABLE "AITradeNote" ADD COLUMN "usedForMatching" BOOLEAN NOT NULL DEFAULT false;

-- 照合クエリ（usedForMatching = true での絞り込み）用のインデックス。
CREATE INDEX "idx_ai_trade_note_used_for_matching" ON "AITradeNote"("usedForMatching");
