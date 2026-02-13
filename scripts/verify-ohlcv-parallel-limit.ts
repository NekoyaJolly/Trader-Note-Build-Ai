/**
 * OHLCV 並列保存 上限検証
 *
 * 目的: 10〜100 の並列数でDB保存が成功するか検証し、上限を把握する
 * 判定: DBに保存されたか否か（verifyOhlcvSaved で実データ取得できるか）
 *
 * 注意: ローカル単体では 100 でも成功するが、
 *       本番（Cloud Run 複数インスタンス + 他リクエスト）では接続枯渇するため、
 *       実運用は 5 を推奨
 *
 * 実行: npx tsx scripts/verify-ohlcv-parallel-limit.ts
 */

import { fetchAndCacheOhlcv } from '../src/backend/services/fetchAndCacheOhlcv';

const SYMBOL = process.env.SYMBOL || 'EURUSD';
const TIMEFRAME = process.env.TIMEFRAME || '1h';
const PARALLEL_SIZES = [10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100];

async function runWithParallelSize(parallelSize: number): Promise<{ ok: boolean; error?: string }> {
  process.env.UPSERT_PARALLEL_SIZE = String(parallelSize);

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 7); // 7日分

  const result = await fetchAndCacheOhlcv(SYMBOL, TIMEFRAME, startDate, endDate);

  if (result.success) {
    return { ok: true };
  }
  return { ok: false, error: result.error };
}

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('OHLCV 並列保存 上限検証（10〜100）');
  console.log('='.repeat(60));
  console.log(`\nシンボル: ${SYMBOL}, 時間足: ${TIMEFRAME}`);
  console.log('期間: 直近7日');
  console.log('判定: DB保存後、実データ取得で検証\n');

  const results: { parallel: number; ok: boolean; error?: string }[] = [];

  for (const size of PARALLEL_SIZES) {
    process.stdout.write(`並列${size}本: `);
    try {
      const { ok, error } = await runWithParallelSize(size);
      results.push({ parallel: size, ok, error });
      console.log(ok ? '✅ OK' : `❌ NG (${error})`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ parallel: size, ok: false, error: msg });
      console.log(`❌ 例外: ${msg.slice(0, 80)}`);
    }
  }

  // サマリー
  const okSizes = results.filter((r) => r.ok).map((r) => r.parallel);
  const ngSizes = results.filter((r) => !r.ok).map((r) => r.parallel);

  console.log('\n' + '='.repeat(60));
  console.log('検証結果サマリー');
  console.log('='.repeat(60));
  console.log(`✅ 成功: ${okSizes.join(', ') || 'なし'}`);
  console.log(`❌ 失敗: ${ngSizes.join(', ') || 'なし'}`);
  if (okSizes.length > 0) {
    const maxOk = Math.max(...okSizes);
    console.log(`\n→ 検証できた上限: 並列${maxOk}本`);
  }
  console.log('='.repeat(60));

  if (ngSizes.length > 0) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
