/**
 * バックテスト（Node 側）スモークテスト
 *
 * 目的:
 * - Node の `runBacktest()` が DB（Prisma）と analysis-engine（Python）を使って最後まで走ること
 * - 例外なく結果（summary）が返ること
 *
 * 前提:
 * - docker compose で db / analysis-engine が起動済み
 * - scripts/seed-analysis-engine-test.sql で Strategy/Version/OHLCV が作成済み
 * - 環境変数 DATABASE_URL / DIRECT_URL / ANALYSIS_ENGINE_URL を設定して実行
 */

import { runBacktest } from '../src/backend/services/strategyBacktestService';

async function main(): Promise<void> {
  const strategyId = process.env.SMOKE_STRATEGY_ID;
  if (!strategyId) {
    throw new Error('環境変数 SMOKE_STRATEGY_ID を指定してください');
  }

  const result = await runBacktest({
    strategyId,
    startDate: '2026-01-01T00:00:00.000Z',
    endDate: '2026-01-02T00:00:00.000Z',
    stage1Timeframe: '1h',
    runStage2: false,
    initialCapital: 1_000_000,
    lotSize: 10_000,
    lotSizeUnit: 'currency',
    leverage: 25,
    symbol: 'USDJPY',
    lotMode: 'fixed',
    maxPositions: 1,
  });

  console.log('[smoke-backtest] runId=', result.id);
  console.log('[smoke-backtest] totalTrades=', result.summary.totalTrades);
  console.log('[smoke-backtest] totalPnl=', result.summary.totalPnl);
  console.log('[smoke-backtest] winRate=', result.summary.winRate);
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error('[smoke-backtest] failed:', msg);
  process.exitCode = 1;
});
