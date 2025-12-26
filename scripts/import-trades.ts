/**
 * CLI トレードインポートスクリプト
 * 
 * 目的: CSV ファイルから Trade データを DB に投入する初期化ツール
 * 
 * 使用方法:
 *   DATABASE_URL="postgresql://..." npx ts-node scripts/import-trades.ts
 * 
 * 前提:
 *   - sample_trades.csv が data/trades/ に存在する
 *   - TradeImportService.importFromCSV() を使用
 *   - 既存の Prisma Client を利用
 */

import path from 'path';
import { TradeImportService } from '../src/services/tradeImportService';
import { prisma } from '../src/backend/db/client';

/**
 * メイン実行関数
 */
async function main() {
  console.log('=== CLI トレードインポート開始 ===\n');

  try {
    // CSV ファイルパスの構築
    const csvPath = path.join(__dirname, '..', 'data', 'trades', 'sample_trades.csv');
    console.log(`CSV ファイルパス: ${csvPath}`);

    // TradeImportService のインスタンス生成
    const importService = new TradeImportService();

    // CSV からインポート実行
    console.log('\nCSV 読み込み中...');
    const result = await importService.importFromCSV(csvPath);

    // 結果出力
    console.log('\n=== インポート完了 ===');
    console.log(`✓ Trade レコード保存: OK（件数: ${result.tradesImported}）`);
    console.log('✓ Prisma エラー: なし\n');

    // DB 接続確認
    const totalTrades = await prisma.trade.count();
    console.log(`DB 内 Trade 総数: ${totalTrades} 件`);

  } catch (error) {
    console.error('\n❌ エラーが発生しました:');
    
    if (error instanceof Error) {
      console.error(`エラーメッセージ: ${error.message}`);
      console.error(`スタックトレース:\n${error.stack}`);
    } else {
      console.error(error);
    }

    // DB 接続エラーの場合は即時終了
    process.exit(1);
  } finally {
    // Prisma Client の切断
    await prisma.$disconnect();
    console.log('\nDB 接続を切断しました。');
  }
}

// スクリプト実行
main()
  .then(() => {
    console.log('\n=== CLI トレードインポート正常終了 ===');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n予期しないエラー:', error);
    process.exit(1);
  });
