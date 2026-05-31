/**
 * CronSimilarityService テスト
 * 
 * 目的: Cron監視用類似度チェックサービスの動作確認
 */

import { CronSimilarityService } from '../services/cronSimilarityService';
import { crossSimilarityService } from '../../services/crossSimilarityService';
import type { NotificationTriggerService } from '../../services/notification/notificationTriggerService';
import type { OHLCVData } from '../../services/indicators/indicatorService';
import type { CrossSearchResult } from '../../services/crossSimilarityService';

// ========================================
// モック
// ========================================

jest.mock('../../services/crossSimilarityService', () => ({
  crossSimilarityService: {
    searchSimilarNotes: jest.fn(),
  },
}));

jest.mock('../../services/notification/notificationTriggerService');

// ========================================
// テストデータ
// ========================================

const mockOHLCVData: OHLCVData[] = [
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

const mockSearchResult: CrossSearchResult = {
  results: [
    {
      noteId: 'note-1',
      noteType: 'aiTradeNote',
      similarity: 0.90,
      distance: 0.1,
      symbol: 'EUR/USD',
      date: '2024-01-01',
      direction: 'long',
      outcome: 'win',
      pnl: 50,
      metadata: {},
    },
    {
      noteId: 'note-2',
      noteType: 'tradeNote',
      similarity: 0.87,
      distance: 0.13,
      symbol: 'EUR/USD',
      date: '2024-01-02',
      direction: 'short',
      outcome: 'loss',
      pnl: -20,
      metadata: {},
    },
    {
      noteId: 'note-3',
      noteType: 'aiTradeNote',
      similarity: 0.70,
      distance: 0.3,
      symbol: 'EUR/USD',
      date: '2024-01-03',
      direction: 'long',
      outcome: 'win',
      pnl: 30,
      metadata: {},
    },
  ],
  totalCount: 3,
  searchStats: {
    tradeNotesSearched: 50,
    aiTradeNotesSearched: 30,
    tradeNotesMatched: 1,
    aiTradeNotesMatched: 2,
  },
};

// ========================================
// テスト
// ========================================

describe('CronSimilarityService', () => {
  let service: CronSimilarityService;
  let mockNotificationTrigger: jest.Mocked<NotificationTriggerService>;

  beforeEach(() => {
    jest.clearAllMocks();

    // NotificationTriggerService のモック
    mockNotificationTrigger = {
      evaluateWithPersistence: jest.fn(),
    } as any;

    service = new CronSimilarityService(
      {
        similarityThreshold: 0.85,
        topK: 10,
        debug: false,
      },
      mockNotificationTrigger
    );
  });

  describe('設定', () => {
    it('デフォルト設定で初期化できる', () => {
      const defaultService = new CronSimilarityService();
      const config = defaultService.getConfig();

      expect(config.similarityThreshold).toBe(0.85);
      expect(config.topK).toBe(5);
      expect(config.minSimilarity).toBe(0.5);
      expect(config.searchTradeNotes).toBe(true);
      expect(config.searchAITradeNotes).toBe(true);
      expect(config.notificationChannel).toBe('in_app');
    });

    it('カスタム設定で初期化できる', () => {
      const customService = new CronSimilarityService({
        similarityThreshold: 0.90,
        topK: 20,
        minSimilarity: 0.70,
        notificationChannel: 'push',
      });

      const config = customService.getConfig();

      expect(config.similarityThreshold).toBe(0.90);
      expect(config.topK).toBe(20);
      expect(config.minSimilarity).toBe(0.70);
      expect(config.notificationChannel).toBe('push');
    });

    it('不正な設定でエラーをスローする', () => {
      expect(() => {
        new CronSimilarityService({
          similarityThreshold: 1.5, // 0-1の範囲外
        });
      }).toThrow('CronSimilarityService 設定エラー');
    });

    it('設定を更新できる', () => {
      service.updateConfig({ similarityThreshold: 0.90 });
      const config = service.getConfig();

      expect(config.similarityThreshold).toBe(0.90);
    });
  });

  describe('checkSimilarityAndNotify', () => {
    beforeEach(() => {
      (crossSimilarityService.searchSimilarNotes as jest.Mock).mockResolvedValue(
        mockSearchResult
      );
    });

    it('類似ノートを検索して閾値以上のみ抽出する', async () => {
      const result = await service.checkSimilarityAndNotify({
        symbol: 'EUR/USD',
        ohlcvData: mockOHLCVData,
        timeframe: '1h',
      });

      // crossSimilarityService が呼ばれた。
      // 実行時のライブ照合では AIノートを「本番運用」選別済みのみに限定する。
      expect(crossSimilarityService.searchSimilarNotes).toHaveBeenCalledWith({
        ohlcvData: mockOHLCVData,
        symbol: 'EUR/USD',
        topK: 10,
        minSimilarity: 0.5,
        searchTradeNotes: true,
        searchAITradeNotes: true,
        aiNotesUsedForMatchingOnly: true,
      });

      // 閾値85%以上の2件のみマッチ
      expect(result.similarNotesFound).toBe(2);
      expect(result.matches).toHaveLength(2);
      expect(result.matches[0].similarity).toBe(0.90);
      expect(result.matches[1].similarity).toBe(0.87);

      // 統計情報
      expect(result.stats.tradeNotesSearched).toBe(50);
      expect(result.stats.aiTradeNotesSearched).toBe(30);
      expect(result.stats.totalMatched).toBe(2);
    });

    it('閾値以上のノートに対して通知を送信する', async () => {
      mockNotificationTrigger.evaluateWithPersistence.mockResolvedValue({
        shouldNotify: true,
        status: 'sent',
        notificationLogId: 'log-1',
      });

      const result = await service.checkSimilarityAndNotify({
        symbol: 'EUR/USD',
        ohlcvData: mockOHLCVData,
      });

      // 2件のマッチに対して2回通知トリガーが呼ばれる
      expect(mockNotificationTrigger.evaluateWithPersistence).toHaveBeenCalledTimes(2);

      // 1件目の通知
      expect(mockNotificationTrigger.evaluateWithPersistence).toHaveBeenNthCalledWith(1, {
        matchScore: 0.90,
        historicalNoteId: 'note-1',
        marketSnapshot: expect.objectContaining({
          symbol: 'EUR/USD',
          similarity: 0.90,
          noteType: 'aiTradeNote',
        }),
        marketSnapshotId: expect.any(String),
        symbol: 'EUR/USD',
        channel: 'in_app',
      });

      // 通知送信成功
      expect(result.notificationsSent).toBe(2);
      expect(result.notifications).toHaveLength(2);
      expect(result.notifications[0].sent).toBe(true);
      expect(result.notifications[0].noteId).toBe('note-1');
    });

    it('通知がスキップされた場合も記録する', async () => {
      mockNotificationTrigger.evaluateWithPersistence
        .mockResolvedValueOnce({
          shouldNotify: true,
          status: 'sent',
        })
        .mockResolvedValueOnce({
          shouldNotify: false,
          status: 'skipped',
          skipReason: 'クールダウン中',
        });

      const result = await service.checkSimilarityAndNotify({
        symbol: 'EUR/USD',
        ohlcvData: mockOHLCVData,
      });

      expect(result.notificationsSent).toBe(1);
      expect(result.notifications).toHaveLength(2);
      expect(result.notifications[0].sent).toBe(true);
      expect(result.notifications[1].sent).toBe(false);
      expect(result.notifications[1].skipReason).toBe('クールダウン中');
    });

    it('類似ノートが見つからない場合は通知しない', async () => {
      (crossSimilarityService.searchSimilarNotes as jest.Mock).mockResolvedValue({
        results: [],
        totalCount: 0,
        searchStats: {
          tradeNotesSearched: 50,
          aiTradeNotesSearched: 30,
          tradeNotesMatched: 0,
          aiTradeNotesMatched: 0,
        },
      });

      const result = await service.checkSimilarityAndNotify({
        symbol: 'EUR/USD',
        ohlcvData: mockOHLCVData,
      });

      expect(result.similarNotesFound).toBe(0);
      expect(result.notificationsSent).toBe(0);
      expect(mockNotificationTrigger.evaluateWithPersistence).not.toHaveBeenCalled();
    });

    it('検索エラー時も結果を返す', async () => {
      (crossSimilarityService.searchSimilarNotes as jest.Mock).mockRejectedValue(
        new Error('検索失敗')
      );

      const result = await service.checkSimilarityAndNotify({
        symbol: 'EUR/USD',
        ohlcvData: mockOHLCVData,
      });

      expect(result.similarNotesFound).toBe(0);
      expect(result.notificationsSent).toBe(0);
      expect(result.stats.totalMatched).toBe(0);
    });

    it('通知送信エラー時も他の通知は継続する', async () => {
      mockNotificationTrigger.evaluateWithPersistence
        .mockRejectedValueOnce(new Error('通知失敗'))
        .mockResolvedValueOnce({
          shouldNotify: true,
          status: 'sent',
        });

      const result = await service.checkSimilarityAndNotify({
        symbol: 'EUR/USD',
        ohlcvData: mockOHLCVData,
      });

      // 1件は失敗、1件は成功
      expect(result.notificationsSent).toBe(1);
      expect(result.notifications).toHaveLength(2);
      expect(result.notifications[0].sent).toBe(false);
      expect(result.notifications[0].skipReason).toContain('送信エラー');
      expect(result.notifications[1].sent).toBe(true);
    });
  });

  describe('checkMultipleSymbols', () => {
    beforeEach(() => {
      (crossSimilarityService.searchSimilarNotes as jest.Mock).mockResolvedValue(
        mockSearchResult
      );
      mockNotificationTrigger.evaluateWithPersistence.mockResolvedValue({
        shouldNotify: true,
        status: 'sent',
      });
    });

    it('複数シンボルを順次処理する', async () => {
      const results = await service.checkMultipleSymbols([
        {
          symbol: 'EUR/USD',
          ohlcvData: mockOHLCVData,
        },
        {
          symbol: 'GBP/USD',
          ohlcvData: mockOHLCVData,
        },
      ]);

      expect(results).toHaveLength(2);
      expect(results[0].symbol).toBe('EUR/USD');
      expect(results[1].symbol).toBe('GBP/USD');
      expect(crossSimilarityService.searchSimilarNotes).toHaveBeenCalledTimes(2);
    });
  });

  describe('閾値設定のテスト', () => {
    it('閾値90%で1件のみマッチ', async () => {
      const highThresholdService = new CronSimilarityService(
        {
          similarityThreshold: 0.90,
        },
        mockNotificationTrigger
      );

      (crossSimilarityService.searchSimilarNotes as jest.Mock).mockResolvedValue(
        mockSearchResult
      );

      const result = await highThresholdService.checkSimilarityAndNotify({
        symbol: 'EUR/USD',
        ohlcvData: mockOHLCVData,
      });

      // 90%以上は1件のみ
      expect(result.similarNotesFound).toBe(1);
      expect(result.matches[0].similarity).toBe(0.90);
    });

    it('閾値70%で3件すべてマッチ', async () => {
      const lowThresholdService = new CronSimilarityService(
        {
          similarityThreshold: 0.70,
        },
        mockNotificationTrigger
      );

      (crossSimilarityService.searchSimilarNotes as jest.Mock).mockResolvedValue(
        mockSearchResult
      );

      const result = await lowThresholdService.checkSimilarityAndNotify({
        symbol: 'EUR/USD',
        ohlcvData: mockOHLCVData,
      });

      // 70%以上は3件すべて
      expect(result.similarNotesFound).toBe(3);
    });
  });
});
