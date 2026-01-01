#!/usr/bin/env npx ts-node

/**
 * OHLCV 日次インジェストスクリプト
 *
 * ウォッチリストに登録されたシンボルのOHLCVデータを取得し、DBに蓄積
 * Railway Cron または手動で実行
 *
 * 使用方法:
 *   npx ts-node scripts/run-ohlcv-ingest.ts [--output-size=100] [--prune] [--prune-days=180]
 *
 * オプション:
 *   --output-size=N   各シンボルの取得件数（デフォルト: 100）
 *   --prune           古いデータを削除
 *   --prune-days=N    保持日数（デフォルト: 180日）
 */

import { ingestAllWatchlist, pruneOldData } from '../src/backend/services/ohlcvIngestService';

/**
 * コマンドライン引数をパース
 */
function parseArgs(): {
  outputSize: number;
  prune: boolean;
  pruneDays: number;
} {
  const args = process.argv.slice(2);
  let outputSize = 100;
  let prune = false;
  let pruneDays = 180;

  for (const arg of args) {
    if (arg.startsWith('--output-size=')) {
      outputSize = parseInt(arg.split('=')[1], 10) || 100;
    } else if (arg === '--prune') {
      prune = true;
    } else if (arg.startsWith('--prune-days=')) {
      pruneDays = parseInt(arg.split('=')[1], 10) || 180;
    }
  }

  return { outputSize, prune, pruneDays };
}

/**
 * メイン処理
 */
async function main(): Promise<void> {
  console.log('═══════════════════════════════════════');
  console.log('  OHLCV 日次インジェスト');
  console.log('═══════════════════════════════════════');
  console.log(`  開始時刻: ${new Date().toISOString()}`);
  console.log('═══════════════════════════════════════\n');

  const { outputSize, prune, pruneDays } = parseArgs();

  console.log(`設定: outputSize=${outputSize}, prune=${prune}, pruneDays=${pruneDays}\n`);

  try {
    // OHLCVデータのインジェスト
    const summary = await ingestAllWatchlist(outputSize);

    console.log('\n═══════════════════════════════════════');
    console.log('  インジェスト結果');
    console.log('═══════════════════════════════════════');
    console.log(`  シンボル数: ${summary.totalSymbols}`);
    console.log(`  時間足数: ${summary.totalTimeframes}`);
    console.log(`  取得件数: ${summary.totalFetched}`);
    console.log(`  保存件数: ${summary.totalSaved}`);
    console.log(`  スキップ件数: ${summary.totalSkipped}`);
    console.log(`  エラー数: ${summary.errors.length}`);
    console.log(`  処理時間: ${(summary.endTime.getTime() - summary.startTime.getTime()) / 1000}秒`);

    if (summary.errors.length > 0) {
      console.log('\nエラー詳細:');
      for (const error of summary.errors) {
        console.log(`  - ${error}`);
      }
    }

    // 古いデータの削除（オプション）
    if (prune) {
      console.log('\n古いデータを削除中...');
      const deletedCount = await pruneOldData(pruneDays);
      console.log(`  削除件数: ${deletedCount}`);
    }

    console.log('\n═══════════════════════════════════════');
    console.log('  完了');
    console.log('═══════════════════════════════════════\n');

    // エラーがあった場合は終了コード1
    if (summary.errors.length > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error('致命的エラー:', error);
    process.exit(1);
  }
}

// 実行
main();
