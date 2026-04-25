/*
 * CI 用 DB 統合テスト設定。
 *
 * Supabase/Prisma の session pool 枯渇を避けるため、DB を触るテストは
 * 必ず 1 worker / in-band で実行する。
 */
import type { Config } from 'jest';
import baseConfig from './jest.config';

const config: Config = {
  ...baseConfig,
  maxWorkers: 1,
  testMatch: [
    '<rootDir>/src/backend/tests/tradeImportService.test.ts',
    '<rootDir>/src/backend/tests/tradeNoteIntegration.test.ts',
    '<rootDir>/src/backend/tests/revaluationJobService.test.ts',
    '<rootDir>/src/backend/tests/marketIngestService.test.ts',
    '<rootDir>/src/backend/tests/ohlcvRepository.test.ts',
    '<rootDir>/src/backend/tests/featureService.test.ts',
    '<rootDir>/src/backend/tests/crossSimilarityService.test.ts',
  ],
};

export default config;
