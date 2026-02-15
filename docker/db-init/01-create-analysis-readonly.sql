-- analysis-engine 用の Read-Only ユーザーを作成
-- 注意:
-- - ローカル開発用。運用環境では IAM / Secret 管理を推奨

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'analysis_ro') THEN
    CREATE ROLE analysis_ro LOGIN PASSWORD 'analysis_ro';
  END IF;
END $$;

-- public スキーマ利用
GRANT USAGE ON SCHEMA public TO analysis_ro;

-- 既存テーブルへの SELECT 権限
GRANT SELECT ON ALL TABLES IN SCHEMA public TO analysis_ro;

-- 今後追加されるテーブルにも自動付与
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO analysis_ro;

-- 追加防止（念のため）: セッションのデフォルトを Read-Only
ALTER ROLE analysis_ro SET default_transaction_read_only = on;
