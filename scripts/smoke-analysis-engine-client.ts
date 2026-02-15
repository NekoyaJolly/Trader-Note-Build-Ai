/**
 * analysis-engine（Python）疎通のスモークテスト
 *
 * 目的:
 * - Node（analysisEngineClient）→ Python（analysis-engine）への疎通確認
 * - /v1/indicator-series/by-version のレスポンスが Zod でパースできること
 * - cacheKey（indicatorId + params + field）が期待どおりの形式で返ること
 *
 * 注意:
 * - 事前に docker compose で db / analysis-engine を起動しておくこと
 * - 事前に scripts/seed-analysis-engine-test.sql を流して Strategy/Version/OHLCV を作成しておくこと
 */

import { fetchIndicatorSeriesByStrategyVersion } from '../src/backend/services/analysisEngineClient';

async function main(): Promise<void> {
  const strategyId = process.env.SMOKE_STRATEGY_ID;
  const versionId = process.env.SMOKE_VERSION_ID;

  if (!strategyId || !versionId) {
    throw new Error('環境変数 SMOKE_STRATEGY_ID / SMOKE_VERSION_ID を指定してください');
  }

  const res = await fetchIndicatorSeriesByStrategyVersion({
    strategyId,
    versionId,
    symbol: 'USDJPY',
    timeframe: '1h',
    startDate: new Date('2026-01-01T00:00:00.000Z'),
    endDate: new Date('2026-01-01T23:00:00.000Z'),
    patterns: [],
  });

  const keys = Object.keys(res.series);
  console.log('[smoke] symbol=', res.symbol, 'timeframe=', res.timeframe);
  console.log('[smoke] timestamps=', res.timestamps.length);
  console.log('[smoke] seriesKeys=', keys);
  if (keys[0]) {
    console.log('[smoke] firstSeriesLength=', res.series[keys[0]]?.length);
  }
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error('[smoke] failed:', msg);
  process.exitCode = 1;
});
