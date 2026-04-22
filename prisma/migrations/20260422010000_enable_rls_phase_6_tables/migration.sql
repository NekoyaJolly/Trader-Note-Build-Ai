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
