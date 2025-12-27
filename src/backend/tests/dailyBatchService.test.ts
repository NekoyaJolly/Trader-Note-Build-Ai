import { DailyBatchService } from '../../services/dailyBatchService';
import { Trade, TradeSide } from '@prisma/client';

// 依存サービスのテスト用モック実装
class MockTradeImportService {
  importFromCSV = jest.fn().mockResolvedValue({ tradesImported: 2, skipped: 0, errors: [], file: 'dummy.csv' });
}

class MockTradeRepository {
  trades: Trade[] = [];

  constructor() {
    const base: Partial<Trade> = {
      symbol: 'BTCUSDT',
      side: 'buy',
      price: 42000 as any,
      quantity: 0.1 as any,
      fee: null,
      exchange: 'Binance',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.trades = [
      { id: 't1', timestamp: new Date('2024-01-01T00:00:00Z'), ...base } as Trade,
      { id: 't2', timestamp: new Date('2024-01-02T00:00:00Z'), ...base } as Trade,
    ];
  }

  findTradesWithoutNotes = jest.fn().mockImplementation(() => Promise.resolve(this.trades));
}

class MockTradeNoteGeneratorService {
  generateAndSaveNote = jest.fn().mockResolvedValue({ noteId: 'n1', tradeId: 't1' });
}

class MockMarketIngestService {
  ingestSymbol = jest.fn().mockResolvedValue(undefined);
}

class MockMatchEvaluationService {
  evaluateAllNotes = jest.fn().mockResolvedValue([
    { id: 'm1', noteId: 'n1', marketSnapshotId: 's1', symbol: 'BTCUSDT', score: 0.9, threshold: 0.75, trendMatched: true, priceRangeMatched: true, reasons: [], decidedAt: new Date(), createdAt: new Date(), evaluatedAt: new Date() },
  ]);
}

class MockMatchResultRepository {
  findWithRelations = jest.fn().mockResolvedValue([
    {
      id: 'm1',
      noteId: 'n1',
      marketSnapshotId: 's1',
      symbol: 'BTCUSDT',
      score: 0.9,
      threshold: 0.75,
      trendMatched: true,
      priceRangeMatched: true,
      reasons: [],
      decidedAt: new Date(),
      createdAt: new Date(),
      evaluatedAt: new Date(),
      note: { id: 'n1', tradeId: 't1', symbol: 'BTCUSDT', entryPrice: 42000 as any, side: TradeSide.buy, indicators: {}, featureVector: [0,0,0,0,0,0,0], timeframe: '15m', createdAt: new Date(), updatedAt: new Date() },
      marketSnapshot: { id: 's1', symbol: 'BTCUSDT', timeframe: '15m', close: 42000 as any, volume: 1000 as any, indicators: {}, fetchedAt: new Date(), createdAt: new Date() },
    },
  ]);
}

class MockNotificationTriggerService {
  evaluateAndNotify = jest.fn().mockResolvedValue({ shouldNotify: true, status: 'sent' as const });
}

class MockMarketDataService {
  getCurrentMarketData = jest.fn().mockResolvedValue({
    symbol: 'BTCUSDT',
    timestamp: new Date(),
    timeframe: '15m',
    open: 42000,
    high: 42100,
    low: 41900,
    close: 42050,
    volume: 1000,
    indicators: { rsi: 55, macd: 0.1 },
  });
}

describe('DailyBatchService', () => {
  const buildService = () => {
    return new DailyBatchService(
      new MockTradeImportService() as any,
      new MockTradeRepository() as any,
      new MockTradeNoteGeneratorService() as any,
      new MockMarketIngestService() as any,
      new MockMatchEvaluationService() as any,
      new MockNotificationTriggerService() as any,
      new MockMatchResultRepository() as any,
      new MockMarketDataService() as any,
    );
  };

  test('正常系: 全ステップが成功し、サマリが返る', async () => {
    const service = buildService();
    const report = await service.run({ csvFilePath: 'dummy.csv' });

    expect(report.importSummary?.tradesImported).toBe(2);
    expect(report.noteSummary.generated).toBe(2);
    expect(report.snapshotSummary.ingested).toBe(2); // 1 symbol × 2 timeframe
    expect(report.matchSummary.evaluated).toBe(1);
    expect(report.notificationSummary.sent).toBe(1);
    expect(report.errors).toHaveLength(0);
  });

  test('部分失敗: ノート生成が失敗しても処理を継続する', async () => {
    const repo = new MockTradeRepository();
    const generator = new MockTradeNoteGeneratorService();
    generator.generateAndSaveNote = jest.fn()
      .mockResolvedValueOnce({ noteId: 'n1', tradeId: 't1' })
      .mockRejectedValueOnce(new Error('生成失敗'));

    const service = new DailyBatchService(
      new MockTradeImportService() as any,
      repo as any,
      generator as any,
      new MockMarketIngestService() as any,
      new MockMatchEvaluationService() as any,
      new MockNotificationTriggerService() as any,
      new MockMatchResultRepository() as any,
      new MockMarketDataService() as any,
    );

    const report = await service.run();

    expect(report.noteSummary.generated).toBe(1);
    expect(report.noteSummary.failed).toBe(1);
    expect(report.warnings.length).toBeGreaterThan(0);
  });

  test('致命失敗: failFast=true で一致判定が例外なら例外を投げる', async () => {
    const badMatchService = new MockMatchEvaluationService();
    badMatchService.evaluateAllNotes = jest.fn().mockRejectedValue(new Error('match error'));

    const service = new DailyBatchService(
      new MockTradeImportService() as any,
      new MockTradeRepository() as any,
      new MockTradeNoteGeneratorService() as any,
      new MockMarketIngestService() as any,
      badMatchService as any,
      new MockNotificationTriggerService() as any,
      new MockMatchResultRepository() as any,
      new MockMarketDataService() as any,
    );

    await expect(service.run({ failFast: true })).rejects.toThrow('match error');
  });
});
