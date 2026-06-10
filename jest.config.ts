/*
 * Jest 設定ファイル（ts-jest 使用）
 * 目的: Phase1 テストの実行環境を整える
 * 注意: コメントは日本語で記述し、環境変数は .env または setup で設定
 */
import type { Config } from 'jest';

/**
 * 実 DB (PostgreSQL) に接続する統合テストの一覧。
 *
 * これらは TRUNCATE / deleteMany を含む破壊的操作を行うため、既定の `npm test` から
 * 除外し、`npm run test:integration:db` (jest.db.config.ts) 経由でのみ実行する。
 * 理由: ローカル .env / CI secrets の DATABASE_URL が本番 Supabase を指した状態で
 * 実行され、本番テーブルが TRUNCATE される事故が発生した (2026-06-11 調査で確定)。
 */
export const dbIntegrationTestFiles = [
  'src/backend/tests/tradeImportService.test.ts',
  'src/backend/tests/tradeNoteIntegration.test.ts',
  'src/backend/tests/revaluationJobService.test.ts',
  'src/backend/tests/marketIngestService.test.ts',
  'src/backend/tests/ohlcvRepository.test.ts',
  'src/backend/tests/featureService.test.ts',
  'src/backend/tests/crossSimilarityService.test.ts',
];

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: [
    '**/backend/tests/**/*.test.ts',
    '**/services/tests/**/*.test.ts',
    '**/side-b/tests/**/*.test.ts',  // Side-B テスト追加
  ],
  // 実 DB 接続スイートを既定実行から除外 (実行経路は jest.db.config.ts のみ)
  testPathIgnorePatterns: ['/node_modules/', ...dbIntegrationTestFiles],
  setupFiles: ['<rootDir>/jest.setup.ts'],
  setupFilesAfterEnv: ['<rootDir>/src/backend/tests/setup/after-env.ts'],
  globalSetup: '<rootDir>/src/backend/tests/setup/global-setup.ts',
  globalTeardown: '<rootDir>/src/backend/tests/setup/global-teardown.ts',
  moduleFileExtensions: ['ts', 'js', 'json'],
  verbose: true,
  testTimeout: 30000, // 30秒（デフォルト5秒から延長）
  // Supabase/pgBouncer の session pool は小さいため、CI では Prisma-heavy テストの
  // 同時接続数を抑える。ローカルは従来通り Jest 既定値。
  ...(process.env.CI === 'true' ? { maxWorkers: 1 } : {}),
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: 'tsconfig.test.json',
    }],
    // @google/adk が内部で require する ESM-only パッケージ (lodash-es 等) を CJS
    // に変換するため、許可リスト内の .js は babel-jest で transform する。
    '^.+\\.js$': ['babel-jest', {
      presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
    }],
  },
  // Jest 既定 (`node_modules/` 全除外) を上書きし、ESM-only パッケージのみ
  // transform 対象に含める。@google/adk 経由で lodash-es を require するため。
  transformIgnorePatterns: [
    '/node_modules/(?!(@google/adk|@google/genai|lodash-es|uuid)/)',
  ],
};

export default config;
