/*
 * CI 用ユニットテスト設定。
 *
 * DB/Supabase に触る重い統合テストは `jest.db.config.ts` に分離し、
 * PR の主要チェックを外部依存なしで安定させる。
 * 除外リストは jest.config.ts の `dbIntegrationTestFiles` を単一の正本とする。
 */
import type { Config } from 'jest';
import baseConfig, { dbIntegrationTestFiles } from './jest.config';

const config: Config = {
  ...baseConfig,
  testPathIgnorePatterns: ['/node_modules/', ...dbIntegrationTestFiles],
};

export default config;
