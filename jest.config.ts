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
  testMatch: ['**/backend/tests/**/*.test.ts', '**/services/tests/**/*.test.ts'],
  setupFiles: ['<rootDir>/jest.setup.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  verbose: true,
};

export default config;
