/**
 * TradeImportService のテスト
 * 対象: CSV 正常系 / 不正行スキップ
 * ルール: コメントは日本語、DB 保存は Prisma 経由で検証
 */
import path from 'path';
import fs from 'fs';
import { TradeImportService } from '../../services/tradeImportService';
import { TradeRepository } from '../../backend/repositories/tradeRepository';

describe('TradeImportService', () => {
  const service = new TradeImportService();
  const repo = new TradeRepository();

  test('CSV 正常系: sample_trades.csv を取り込み、5件保存される', async () => {
    const before = await repo.countAll();
    const file = path.join(process.cwd(), 'data', 'trades', 'sample_trades.csv');

    const result = await service.importFromCSV(file);
    const after = await repo.countAll();

    // 取り込み件数が 5 件であり、DB 件数が +5 されること
    expect(result.tradesImported).toBe(5);
    expect(after - before).toBe(5);
  });

  test('不正行スキップ: 不正行を含む一時CSVで有効行のみ保存される', async () => {
    const tmpFile = path.join(process.cwd(), 'data', 'trades', 'tmp_invalid.csv');
    // 不正行（side 空、price 0、timestamp 不正）を含む CSV を生成
    const csvContent = [
      'timestamp,symbol,side,price,quantity,fee,exchange',
      '2024-01-15T10:30:00Z,BTCUSDT,buy,42000.00,0.1,4.20,Binance', // 有効
      '2024-01-15T10:30:00Z,BTCUSDT,,42000.00,0.1,4.20,Binance', // side 不正
      '2024-01-15T10:30:00Z,BTCUSDT,sell,0,0.1,4.20,Binance', // price 0 不正
      'INVALID_DATE,BTCUSDT,buy,42000.00,0.1,4.20,Binance', // timestamp 不正
    ].join('\n');

    fs.writeFileSync(tmpFile, csvContent);
    const before = await repo.countAll();

    const result = await service.importFromCSV(tmpFile);
    const after = await repo.countAll();

    // 有効行は 1 行のみ保存される
    expect(result.tradesImported).toBe(1);
    expect(after - before).toBe(1);

    // 後片付け
    fs.unlinkSync(tmpFile);
  });
});
