/*
 * CI 用 DB 統合テスト設定。
 *
 * Supabase/Prisma の session pool 枯渇を避けるため、DB を触るテストは
 * 必ず 1 worker / in-band で実行する。
 *
 * 安全ゲート: このスイートは TRUNCATE を含む破壊的操作を行うため、
 * DATABASE_URL が localhost 以外を指している場合は実行を拒否する。
 * 理由: CI が本番 Supabase に対して本スイートを実行し、本番テーブルが
 * TRUNCATE される事故が発生した (2026-06-11 調査で確定)。
 */
import type { Config } from 'jest';
import * as dotenv from 'dotenv';
import baseConfig, { dbIntegrationTestFiles } from './jest.config';

// ローカル実行では .env から DATABASE_URL を読む (CI ではステップ env が優先され、
// dotenv は既存の環境変数を上書きしない)
dotenv.config();

/**
 * DATABASE_URL がローカル DB (localhost / 127.0.0.1) を指していることを検証する。
 * 共有/本番 DB への破壊的テスト実行を構成読込時点でブロックする最前段のガード。
 * (TRUNCATE 直前の最終ガードは src/backend/tests/helpers/testDbCleanup.ts 側にもある)
 */
function assertLocalDatabaseUrl(): void {
  const url = process.env.DATABASE_URL ?? '';
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    host = '';
  }
  const isLocal = host === 'localhost' || host === '127.0.0.1';
  if (!isLocal && process.env.ALLOW_DESTRUCTIVE_DB_TESTS !== 'true') {
    throw new Error(
      [
        '🚫 DB 統合テストの実行を中止しました。',
        `DATABASE_URL のホストが localhost ではありません (host=${host || '解析不能'})。`,
        'このスイートは TRUNCATE を含む破壊的操作を行うため、共有/本番 DB に対しては実行できません。',
        'ローカル PostgreSQL または CI の service container を DATABASE_URL に指定してください。',
        '隔離済み DB だと確信できる場合のみ ALLOW_DESTRUCTIVE_DB_TESTS=true で明示的に解除できます。',
      ].join('\n')
    );
  }
}

assertLocalDatabaseUrl();

const config: Config = {
  ...baseConfig,
  maxWorkers: 1,
  // baseConfig 側で DB 統合テストが除外されているため、このコンフィグでは解除する
  testPathIgnorePatterns: ['/node_modules/'],
  testMatch: dbIntegrationTestFiles.map((file) => `<rootDir>/${file}`),
};

export default config;
