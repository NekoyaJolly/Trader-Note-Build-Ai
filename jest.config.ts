/*
 * Jest 設定ファイル（ts-jest 使用）
 * 目的: Phase1 テストの実行環境を整える
 * 注意: コメントは日本語で記述し、環境変数は .env または setup で設定
 */
import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: [
    '**/backend/tests/**/*.test.ts',
    '**/services/tests/**/*.test.ts',
    '**/side-b/tests/**/*.test.ts',  // Side-B テスト追加
  ],
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
