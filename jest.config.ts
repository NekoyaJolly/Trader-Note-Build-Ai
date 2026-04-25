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
  globalSetup: '<rootDir>/src/backend/tests/setup/global-setup.ts',
  moduleFileExtensions: ['ts', 'js', 'json'],
  verbose: true,
  testTimeout: 30000, // 30秒（デフォルト5秒から延長）
  // Supabase/pgBouncer の session pool は小さいため、CI では Prisma-heavy テストの
  // 同時接続数を抑える。ローカルは従来通り Jest 既定値。
  ...(process.env.CI === 'true' ? { maxWorkers: 2 } : {}),
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: 'tsconfig.test.json',
    }],
  },
};

export default config;
