/**
 * 各種テストCSVファイルのインポートを検証するスクリプト
 */
import path from 'path';
import { TradeImportService } from '../src/services/tradeImportService';
import { prisma } from '../src/backend/db/client';

async function main() {
  const service = new TradeImportService();
  
  const testFiles = [
    'test_trades_minimal.csv',
    'test_trades_invalid.csv',
    'test_trades_recent.csv',
    'test_trades_multi.csv'
  ];

  for (const fileName of testFiles) {
    const filePath = path.join(__dirname, '..', 'data', 'trades', fileName);
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Testing: ${fileName}`);
    console.log('='.repeat(60));
    
    try {
      const result = await service.importFromCSV(filePath);
      console.log(`✓ インポート成功: ${result.tradesImported} 件`);
      console.log(`✓ スキップ: ${result.skipped} 件`);
      
      if (result.errors.length > 0) {
        console.log(`⚠️ エラー (最初の5件):`);
        result.errors.slice(0, 5).forEach((err, i) => {
          console.log(`  ${i + 1}. ${err}`);
        });
      }
    } catch (error) {
      console.log(`❌ インポート失敗:`);
      if (error instanceof Error) {
        console.log(`   ${error.message}`);
      }
    }
  }
  
  await prisma.$disconnect();
}

main().catch(console.error);
