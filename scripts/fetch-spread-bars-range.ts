/**
 * Phase 6.8: cTrader BID/ASK tick から spread bar を取得し DB（SpreadBar）に保存する
 *
 * 使用例:
 *   SYMBOL=XAUUSD TIMEFRAME=15m HOURS=1 npm run fetch:spread-bars-range
 *   SYMBOL=XAUUSD TIMEFRAME=1m START=2026-04-25T10:00:00Z END=2026-04-25T11:00:00Z npm run fetch:spread-bars-range
 */

import { fetchAndCacheSpreadBars } from '../src/backend/services/fetchAndCacheSpreadBars';

function parseISODate(s: string, label: string): Date {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`${label} が不正です: ${s}`);
  }
  return d;
}

async function main(): Promise<void> {
  const symbol = process.env.SYMBOL?.trim() || 'XAUUSD';
  const timeframe = process.env.TIMEFRAME?.trim() || '15m';
  const startEnv = process.env.START;
  const endEnv = process.env.END;
  const hours = Math.max(1, parseInt(process.env.HOURS || '1', 10) || 1);

  const endDate = endEnv ? parseISODate(endEnv, 'END') : new Date();
  const startDate = startEnv
    ? parseISODate(startEnv, 'START')
    : new Date(endDate.getTime() - hours * 60 * 60 * 1000);

  if (endDate.getTime() <= startDate.getTime()) {
    throw new Error('END は START より後である必要があります');
  }

  console.log('══════════════════════════════════════════════════════════');
  console.log('  SpreadBar 期間取得（cTrader BID/ASK tick → DB 保存）');
  console.log('══════════════════════════════════════════════════════════');
  console.log(`  シンボル:     ${symbol}`);
  console.log(`  時間足:       ${timeframe}`);
  console.log(`  期間(UTC):    ${startDate.toISOString()}`);
  console.log(`            〜 ${endDate.toISOString()}`);
  console.log('══════════════════════════════════════════════════════════\n');

  const t0 = Date.now();
  const result = await fetchAndCacheSpreadBars(symbol, timeframe, startDate, endDate);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log('\n──────────────────────────────────────────────────────────');
  if (result.success) {
    console.log(`✅ 成功: ${result.cachedCount} 行を SpreadBar に反映（${elapsed} 秒）`);
    if (result.details) {
      console.log(
        `   期間: ${result.details.startDate} 〜 ${result.details.endDate} / 取得バー: ${result.details.fetchedCount}`,
      );
    }
  } else {
    console.error('❌ 失敗:', result.error ?? '不明');
    process.exit(1);
  }
  console.log('──────────────────────────────────────────────────────────');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
