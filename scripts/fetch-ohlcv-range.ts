/**
 * 指定期間の OHLCV を cTrader 優先で取得し DB（OHLCVCandle）に保存する
 *
 * 目的: バックテスト用に XAUUSD 1m などの長期履歴を事前キャッシュし、
 *       fetchHistoricalData 経由の DSL/ストラテジーBTで実データが使えるようにする。
 *
 * 使用例:
 *   SYMBOL=XAUUSD TIMEFRAME=1m DAYS=30 npm run fetch:ohlcv-range
 *   SYMBOL=XAUUSD TIMEFRAME=1m START=2024-12-01 END=2025-04-25 npm run fetch:ohlcv-range
 *
 * 注意: 1m は cTrader 都合で数〜7日程度ずつに分割取得されるため、長期は時間がかかる。
 */

import { fetchAndCacheOhlcv } from '../src/backend/services/fetchAndCacheOhlcv';

function parseISODate(s: string, label: string): Date {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`${label} が不正です: ${s}（例: 2024-12-01 または 2024-12-01T00:00:00Z）`);
  }
  return d;
}

async function main(): Promise<void> {
  const symbol = process.env.SYMBOL?.trim() || 'XAUUSD';
  const timeframe = process.env.TIMEFRAME?.trim() || '1m';
  const daysEnv = process.env.DAYS;
  const startEnv = process.env.START;
  const endEnv = process.env.END;

  let startDate: Date;
  let endDate: Date;
  if (startEnv && endEnv) {
    startDate = parseISODate(startEnv, 'START');
    endDate = parseISODate(endEnv, 'END');
  } else {
    const days = Math.max(1, parseInt(daysEnv || '30', 10) || 30);
    endDate = new Date();
    startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);
  }

  if (endDate.getTime() <= startDate.getTime()) {
    console.error('END は START より後である必要があります');
    process.exit(1);
  }

  console.log('══════════════════════════════════════════════════════════');
  console.log('  OHLCV 期間取得（cTrader 優先 → DB 保存）');
  console.log('══════════════════════════════════════════════════════════');
  console.log(`  シンボル:     ${symbol}`);
  console.log(`  時間足:       ${timeframe}`);
  console.log(`  期間(UTC):    ${startDate.toISOString()}`);
  console.log(`            〜 ${endDate.toISOString()}`);
  console.log('══════════════════════════════════════════════════════════\n');

  const t0 = Date.now();
  const result = await fetchAndCacheOhlcv(symbol, timeframe, startDate, endDate, (p) => {
    const step = p.total > 0 ? `step ${p.current + 1}/${p.total}` : 'step -';
    console.log(`  [${p.percent ?? 0}%] ${p.source} ${p.message} (${step})`);
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log('\n──────────────────────────────────────────────────────────');
  if (result.success) {
    console.log(`✅ 成功: ${result.cachedCount} 行を DB に反映（想定処理時間 ${elapsed} 秒）`);
    if (result.source) {
      console.log(`   取得元: ${result.source}`);
    }
    if (result.details) {
      console.log(
        `   期間: ${result.details.startDate} 〜 ${result.details.endDate} / チャンク: ${result.details.chunks} / 取得バー: ${result.details.fetchedCount}`,
      );
    }
  } else {
    console.error('❌ 失敗:', result.error ?? '不明');
    process.exit(1);
  }
  console.log('──────────────────────────────────────────────────────────');
  console.log('次: StrategyDSL の timeframe=1m / symbol 一致で runBacktest すると当該期間のキャッシュが使われます。');
  console.log('   シミュ仮定は runDslSimulation(..., { roundTripCostPips, immediateEntryFill 等 })。\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
