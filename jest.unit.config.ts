/*
 * CI 用ユニットテスト設定。
 *
 * DB/Supabase に触る重い統合テストは `jest.db.config.ts` に分離し、
 * PR の主要チェックを外部依存なしで安定させる。
 */
import type { Config } from 'jest';
import baseConfig from './jest.config';

const config: Config = {
  ...baseConfig,
  testPathIgnorePatterns: [
    '/node_modules/',
    'src/backend/tests/tradeImportService.test.ts',
    'src/backend/tests/tradeNoteIntegration.test.ts',
    'src/backend/tests/revaluationJobService.test.ts',
    'src/backend/tests/marketIngestService.test.ts',
    'src/backend/tests/ohlcvRepository.test.ts',
    'src/backend/tests/featureService.test.ts',
    'src/backend/tests/crossSimilarityService.test.ts',
  ],
};

export default config;
