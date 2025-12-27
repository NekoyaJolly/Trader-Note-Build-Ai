/**
 * Railway Cron などから日次バッチを起動するスクリプト
 * 手順: CSV 取込 → ノート生成 → 市場スナップショット → 一致判定 → 通知
 * 実行例:
 *   DAILY_CSV_PATH="data/trades/sample_trades.csv" npx ts-node scripts/run-daily-batch.ts
 */

import path from 'path';
import { DailyBatchService } from '../src/services/dailyBatchService';
import { prisma } from '../src/backend/db/client';

async function main() {
  const csvArg = process.env.DAILY_CSV_PATH || process.argv[2];
  const csvFilePath = csvArg ? path.isAbsolute(csvArg) ? csvArg : path.join(process.cwd(), csvArg) : undefined;
  const failFast = process.env.FAIL_FAST === 'true';

  console.log('=== 日次バッチ開始 ===');
  console.log(`CSV: ${csvFilePath ?? 'スキップ'}`);
  console.log(`failFast: ${failFast}`);

  const service = new DailyBatchService();
  const report = await service.run({ csvFilePath, failFast });

  console.log('\n--- バッチサマリ ---');
  if (report.importSummary) {
    console.log(`インポート: ${report.importSummary.tradesImported} 件 / スキップ ${report.importSummary.skipped}`);
    if (report.importSummary.errors.length > 0) {
      console.log('インポート警告:');
      report.importSummary.errors.forEach((e) => console.log(`  - ${e}`));
    }
  } else {
    console.log('インポート: スキップ');
  }
  console.log(`ノート生成: ${report.noteSummary.generated} / 失敗 ${report.noteSummary.failed}`);
  console.log(`スナップショット生成: ${report.snapshotSummary.ingested} 本 (${report.snapshotSummary.symbols.join(', ') || 'なし'})`);
  console.log(`一致判定: ${report.matchSummary.evaluated} 件`);
  console.log(`通知: 送信 ${report.notificationSummary.sent} / スキップ ${report.notificationSummary.skipped} / 失敗 ${report.notificationSummary.failed}`);

  if (report.warnings.length > 0) {
    console.log('\n⚠️ 警告一覧');
    report.warnings.forEach((w) => console.log(`  - ${w}`));
  }
  if (report.errors.length > 0) {
    console.log('\n❌ エラー一覧');
    report.errors.forEach((e) => console.log(`  - ${e}`));
  }

  console.log('\n=== 日次バッチ終了 ===');
}

main()
  .catch((err) => {
    console.error('バッチ実行中に致命的なエラーが発生しました:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
