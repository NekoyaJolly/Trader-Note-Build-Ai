/**
 * SideBScheduler 類似度チェック統合テスト
 * 
 * 目的: Cron監視での類似度チェック統合の動作確認
 */

import { SideBScheduler } from '../jobs/sideBScheduler';
import { CronSimilarityService } from '../services/cronSimilarityService';
import { MarketDataService } from '../../services/marketDataService';
import type { SimilarityCheckResult } from '../services/cronSimilarityService';

// ========================================
// モック
// ========================================

jest.mock('../services/cronSimilarityService');
jest.mock('../../services/marketDataService');
jest.mock('../utils/marketHours', () => ({
  isFXMarketOpen: jest.fn(() => true),
  getMarketStatusJST: jest.fn(() => ({
    isOpen: true,
    isDST: false,
    message: '市場開場中',
    nextEvent: '次のイベント: 市場閉場',
  })),
}));

// 他の依存をモック
jest.mock('../services/virtualTradeService', () => ({
  expirePendingTrades: jest.fn().mockResolvedValue(0),
  monitorEntryConditions: jest.fn(),
  monitorPositions: jest.fn(),
  createTradeFromPlan: jest.fn(),
}));

jest.mock('../repositories', () => ({
  findVirtualTrades: jest.fn().mockResolvedValue([]),
  updateTradeToOpen: jest.fn(),
  closeTrade: jest.fn(),
  planRepository: {
    findAll: jest.fn().mockResolvedValue([]),
  },
}));

jest.mock('../orchestrator/aiOrchestrator');

// ========================================
// テストデータ
// ========================================

const mockOHLCVData = [
  {
    timestamp: new Date('2024-01-01T10:00:00Z'),
    open: 1.1000,
    high: 1.1050,
    low: 1.0950,
    close: 1.1020,
    volume: 1000,
  },
  {
    timestamp: new Date('2024-01-01T10:01:00Z'),
    open: 1.1020,
    high: 1.1080,
    low: 1.1010,
    close: 1.1060,
    volume: 1200,
  },
];

const mockSimilarityCheckResult: SimilarityCheckResult = {
  symbol: 'XAU/USD',
  timestamp: new Date('2024-01-01T10:00:00Z'),
  similarNotesFound: 2,
  notificationsSent: 1,
  matches: [
    {
      noteId: 'note-1',
      noteType: 'aiTradeNote',
      similarity: 0.90,
      symbol: 'XAU/USD',
      date: '2024-01-01',
      direction: 'long',
      outcome: 'win',
      pnl: 50,
    },
    {
      noteId: 'note-2',
      noteType: 'tradeNote',
      similarity: 0.87,
      symbol: 'XAU/USD',
      date: '2024-01-02',
      direction: 'short',
    },
  ],
  notifications: [
    {
      sent: true,
      noteId: 'note-1',
      similarity: 0.90,
      notificationLogId: 'log-1',
    },
    {
      sent: false,
      noteId: 'note-2',
      similarity: 0.87,
      skipReason: 'スコア不足',
    },
  ],
  stats: {
    tradeNotesSearched: 50,
    aiTradeNotesSearched: 30,
    totalMatched: 2,
  },
};

// ========================================
// テスト
// ========================================

describe('SideBScheduler 類似度チェック統合', () => {
  let scheduler: SideBScheduler;
  let mockMarketDataService: jest.Mocked<MarketDataService>;
  let mockCronSimilarityService: jest.Mocked<CronSimilarityService>;

  beforeEach(() => {
    jest.clearAllMocks();

    // MarketDataService のモック
    mockMarketDataService = new MarketDataService() as jest.Mocked<MarketDataService>;
    mockMarketDataService.getRecentMinuteOHLCV = jest
      .fn()
      .mockResolvedValue(mockOHLCVData);

    // CronSimilarityService のモック
    mockCronSimilarityService = {
      checkSimilarityAndNotify: jest.fn().mockResolvedValue(mockSimilarityCheckResult),
      updateConfig: jest.fn(),
      getConfig: jest.fn().mockReturnValue({
        similarityThreshold: 0.85,
        topK: 5,
        minSimilarity: 0.5,
        searchTradeNotes: true,
        searchAITradeNotes: true,
        notificationChannel: 'in_app',
        debug: false,
      }),
    } as any;

    // スケジューラー初期化
    scheduler = new SideBScheduler({
      enabled: false, // 自動実行は無効
      symbols: ['XAU/USD'],
      timeframe: '15m',
      autoSimilarityCheck: true,
      similarityThreshold: 0.85,
    });

    // プライベートフィールドにモックを注入
    (scheduler as any).marketDataService = mockMarketDataService;
    (scheduler as any).cronSimilarityService = mockCronSimilarityService;
  });

  describe('設定', () => {
    it('類似度チェックがデフォルトで有効', () => {
      const defaultScheduler = new SideBScheduler();
      const status = defaultScheduler.getStatus();

      expect(status.config.autoSimilarityCheck).toBe(true);
      expect(status.config.similarityThreshold).toBe(0.85);
      expect(status.automation.autoSimilarityCheck).toBe(true);
    });

    it('類似度チェックを無効化できる', () => {
      const disabledScheduler = new SideBScheduler({
        autoSimilarityCheck: false,
      });
      const status = disabledScheduler.getStatus();

      expect(status.config.autoSimilarityCheck).toBe(false);
      expect(status.automation.autoSimilarityCheck).toBe(false);
    });

    it('類似度閾値をカスタマイズできる', () => {
      const customScheduler = new SideBScheduler({
        similarityThreshold: 0.90,
      });
      const status = customScheduler.getStatus();

      expect(status.config.similarityThreshold).toBe(0.90);
    });
  });

  describe('executeMonitorJob（手動実行）', () => {
    it('類似度チェックが有効な場合、チェックを実行する', async () => {
      const result = await (scheduler as any).executeMonitorJob();

      // 成功
      expect(result.success).toBe(true);

      // 類似度チェックが呼ばれた
      expect(mockCronSimilarityService.checkSimilarityAndNotify).toHaveBeenCalledWith({
        symbol: 'XAU/USD',
        ohlcvData: expect.arrayContaining([
          expect.objectContaining({
            timestamp: expect.any(Date),
            open: expect.any(Number),
            high: expect.any(Number),
            low: expect.any(Number),
            close: expect.any(Number),
            volume: expect.any(Number),
          }),
        ]),
        timeframe: '15m',
      });

      // メッセージに類似度チェック結果が含まれる
      expect(result.message).toContain('類似度チェック 1件');
      expect(result.message).toContain('通知送信 1件');

      // データに統計が含まれる
      expect(result.data).toMatchObject({
        similarityChecks: 1,
        notificationsSent: 1,
      });
    });

    it('類似度チェックが無効な場合、チェックをスキップする', async () => {
      const disabledScheduler = new SideBScheduler({
        enabled: false,
        autoSimilarityCheck: false,
      });
      (disabledScheduler as any).marketDataService = mockMarketDataService;
      (disabledScheduler as any).cronSimilarityService = mockCronSimilarityService;

      const result = await (disabledScheduler as any).executeMonitorJob();

      // 類似度チェックが呼ばれない
      expect(mockCronSimilarityService.checkSimilarityAndNotify).not.toHaveBeenCalled();

      // メッセージに類似度チェック結果が含まれない
      expect(result.message).not.toContain('類似度チェック');
    });

    it('類似ノートが見つからない場合もエラーにならない', async () => {
      mockCronSimilarityService.checkSimilarityAndNotify.mockResolvedValue({
        symbol: 'XAU/USD',
        timestamp: new Date(),
        similarNotesFound: 0,
        notificationsSent: 0,
        matches: [],
        notifications: [],
        stats: {
          tradeNotesSearched: 50,
          aiTradeNotesSearched: 30,
          totalMatched: 0,
        },
      });

      const result = await (scheduler as any).executeMonitorJob();

      expect(result.success).toBe(true);
      expect(result.data.similarityChecks).toBe(1);
      expect(result.data.notificationsSent).toBe(0);
    });

    it('類似度チェックエラー時もジョブ全体は継続する', async () => {
      mockCronSimilarityService.checkSimilarityAndNotify.mockRejectedValue(
        new Error('検索失敗')
      );

      const result = await (scheduler as any).executeMonitorJob();

      // 監視ジョブ自体は成功
      expect(result.success).toBe(true);

      // エラーが記録される
      expect(result.data.errors).toContainEqual(
        expect.stringContaining('類似度チェック: 検索失敗')
      );
    });

    it('複数シンボルでそれぞれ類似度チェックを実行する', async () => {
      const multiSymbolScheduler = new SideBScheduler({
        enabled: false,
        symbols: ['XAU/USD', 'EUR/USD', 'GBP/USD'],
        autoSimilarityCheck: true,
      });
      (multiSymbolScheduler as any).marketDataService = mockMarketDataService;
      (multiSymbolScheduler as any).cronSimilarityService = mockCronSimilarityService;

      mockCronSimilarityService.checkSimilarityAndNotify.mockResolvedValue({
        ...mockSimilarityCheckResult,
        similarNotesFound: 1,
        notificationsSent: 1,
      });

      const result = await (multiSymbolScheduler as any).executeMonitorJob();

      // 3シンボル × 1回ずつ類似度チェック
      expect(mockCronSimilarityService.checkSimilarityAndNotify).toHaveBeenCalledTimes(3);
      expect(result.data.similarityChecks).toBe(3);
      expect(result.data.notificationsSent).toBe(3); // 各シンボルで1件ずつ
    });
  });

  describe('市場休場時', () => {
    beforeEach(() => {
      const { isFXMarketOpen } = require('../utils/marketHours');
      (isFXMarketOpen as jest.Mock).mockReturnValue(false);
    });

    afterEach(() => {
      // 市場状態を元に戻す
      const { isFXMarketOpen } = require('../utils/marketHours');
      (isFXMarketOpen as jest.Mock).mockReturnValue(true);
    });

    it('類似度チェックをスキップする', async () => {
      const result = await (scheduler as any).executeMonitorJob();

      expect(result.success).toBe(true);
      expect(result.message).toContain('市場が閉まっているため監視をスキップしました');
      expect(mockCronSimilarityService.checkSimilarityAndNotify).not.toHaveBeenCalled();
    });
  });

  describe('データ取得失敗時', () => {
    it('そのシンボルの類似度チェックをスキップする', async () => {
      mockMarketDataService.getRecentMinuteOHLCV.mockRejectedValue(
        new Error('データ取得失敗')
      );

      const result = await (scheduler as any).executeMonitorJob();

      // データ取得失敗エラーが記録される（エラーメッセージの形式: "XAU/USD: データ取得失敗"）
      expect(result.data).toBeDefined();
      expect(result.data.errors).toContainEqual(
        expect.stringContaining('データ取得失敗')
      );

      // 類似度チェックは呼ばれない
      expect(mockCronSimilarityService.checkSimilarityAndNotify).not.toHaveBeenCalled();
    });
  });
});
