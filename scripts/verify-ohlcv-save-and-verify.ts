/**
 * OHLCV 保存・検証スクリプト
 *
 * 目的: cTrader API 取得 → DB保存（直列/並列）→ 実データ取得検証 の一連の流れを検証
 *
 * 使用方法:
 *   npx tsx scripts/verify-ohlcv-save-and-verify.ts
 *
 * 直列で問題なければ、fetchAndCacheOhlcv.ts の UPSERT_PARALLEL_SIZE を 5 に変更して再実行
 */

import { fetchAndCacheOhlcv } from '../src/backend/services/fetchAndCacheOhlcv';

const SYMBOL = process.env.SYMBOL || 'EURUSD';
const TIMEFRAME = process.env.TIMEFRAME || '1h';

async function main(): Promise<void> {
  // 直近1日分（1h足なら24本）で検証
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 1);

  console.log('='.repeat(60));
  console.log('OHLCV 保存・検証（DB実データ取得で判定）');
  console.log('='.repeat(60));
  console.log(`\nシンボル: ${SYMBOL}, 時間足: ${TIMEFRAME}`);
  console.log(`期間: ${startDate.toISOString().split('T')[0]} 〜 ${endDate.toISOString().split('T')[0]}`);

  const result = await fetchAndCacheOhlcv(
    SYMBOL,
    TIMEFRAME,
    startDate,
    endDate,
    (p) => console.log(`  進捗: ${p.message} (${p.percent}%)`)
  );

  console.log('\n結果:', result);

  if (result.success) {
    console.log('\n✅ 検証OK: cTrader取得→DB保存→実データ取得 まで正常');
  } else {
    console.log('\n❌ 検証NG:', result.error);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
