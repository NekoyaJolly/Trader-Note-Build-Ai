/**
 * SimultaneousHitControlService テスト
 * 
 * フェーズ8: 複数ノート運用UX
 * 
 * テスト項目:
 * - 優先度順ソート
 * - 同時通知上限（maxSimultaneous）
 * - シンボルグループ化
 * - スキップログ記録
 */

import { PrismaClient } from '@prisma/client';
import {
  SimultaneousHitControlService,
  MatchHit,
  BatchConfig,
} from '../../services/notification/simultaneousHitControlService';

// モック用 Prisma クライアント
const mockPrismaClient = {
  notificationBatchConfig: {
    findFirst: jest.fn(),
    upsert: jest.fn(),
  },
  notificationSkipLog: {
    createMany: jest.fn(),
    findMany: jest.fn(),
  },
  tradeNote: {
    findMany: jest.fn(),
  },
} as unknown as PrismaClient;

describe('SimultaneousHitControlService', () => {
  let service: SimultaneousHitControlService;

  // テスト用ヒットデータ生成
  const createHit = (
    noteId: string,
    symbol: string,
    similarity: number,
    priority: number
  ): MatchHit => ({
    noteId,
    symbol,
    similarity,
    marketSnapshotId: `snapshot-${noteId}`,
    priority,
    matchedAt: new Date(),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SimultaneousHitControlService(mockPrismaClient);
    
    // デフォルトでノートは全て有効として返す
    (mockPrismaClient.tradeNote.findMany as jest.Mock).mockResolvedValue([
      { id: 'note-1' },
      { id: 'note-2' },
      { id: 'note-3' },
      { id: 'note-4' },
      { id: 'note-5' },
    ]);
  });

  describe('control - 優先度ソート', () => {
    it('優先度の高い順にソートされる', async () => {
      const hits = [
        createHit('note-1', 'BTCUSDT', 0.85, 3),
        createHit('note-2', 'BTCUSDT', 0.80, 8),
        createHit('note-3', 'BTCUSDT', 0.75, 5),
      ];

      const config: BatchConfig = {
        maxSimultaneous: 10,
        groupBySymbol: false,
        cooldownMinutes: 15,
      };

      const result = await service.control(hits, config);

      // 優先度順: note-2(8) > note-3(5) > note-1(3)
      expect(result.toNotify[0].noteId).toBe('note-2');
      expect(result.toNotify[1].noteId).toBe('note-3');
      expect(result.toNotify[2].noteId).toBe('note-1');
    });

    it('同優先度の場合は類似度の高い順', async () => {
      const hits = [
        createHit('note-1', 'BTCUSDT', 0.75, 5),
        createHit('note-2', 'BTCUSDT', 0.90, 5),
        createHit('note-3', 'BTCUSDT', 0.85, 5),
      ];

      const config: BatchConfig = {
        maxSimultaneous: 10,
        groupBySymbol: false,
        cooldownMinutes: 15,
      };

      const result = await service.control(hits, config);

      // 類似度順: note-2(90%) > note-3(85%) > note-1(75%)
      expect(result.toNotify[0].noteId).toBe('note-2');
      expect(result.toNotify[1].noteId).toBe('note-3');
      expect(result.toNotify[2].noteId).toBe('note-1');
    });
  });

  describe('control - maxSimultaneous', () => {
    it('上位N件のみが通知対象になる', async () => {
      const hits = [
        createHit('note-1', 'BTCUSDT', 0.85, 10),
        createHit('note-2', 'BTCUSDT', 0.80, 9),
        createHit('note-3', 'BTCUSDT', 0.75, 8),
        createHit('note-4', 'BTCUSDT', 0.70, 7),
        createHit('note-5', 'BTCUSDT', 0.65, 6),
      ];

      const config: BatchConfig = {
        maxSimultaneous: 3,
        groupBySymbol: false,
        cooldownMinutes: 15,
      };

      const result = await service.control(hits, config);

      // 上位3件のみ通知
      expect(result.toNotify).toHaveLength(3);
      expect(result.toSkip).toHaveLength(2);

      // 通知対象: note-1, note-2, note-3
      expect(result.toNotify.map(h => h.noteId)).toEqual(['note-1', 'note-2', 'note-3']);
      
      // スキップ対象: note-4, note-5
      expect(result.toSkip.map(h => h.noteId)).toEqual(['note-4', 'note-5']);
    });

    it('ヒット数が上限以下の場合は全て通知', async () => {
      const hits = [
        createHit('note-1', 'BTCUSDT', 0.85, 10),
        createHit('note-2', 'BTCUSDT', 0.80, 9),
      ];

      const config: BatchConfig = {
        maxSimultaneous: 5,
        groupBySymbol: false,
        cooldownMinutes: 15,
      };

      const result = await service.control(hits, config);

      expect(result.toNotify).toHaveLength(2);
      expect(result.toSkip).toHaveLength(0);
    });
  });

  describe('control - シンボルグループ化', () => {
    it('シンボルごとに maxSimultaneous が適用される', async () => {
      const hits = [
        createHit('note-1', 'BTCUSDT', 0.90, 10),
        createHit('note-2', 'BTCUSDT', 0.85, 9),
        createHit('note-3', 'BTCUSDT', 0.80, 8),
        createHit('note-4', 'ETHUSDT', 0.88, 10),
        createHit('note-5', 'ETHUSDT', 0.82, 9),
      ];

      const config: BatchConfig = {
        maxSimultaneous: 2,
        groupBySymbol: true,
        cooldownMinutes: 15,
      };

      const result = await service.control(hits, config);

      // BTCUSDT: 2件通知、1件スキップ
      // ETHUSDT: 2件通知、0件スキップ
      expect(result.toNotify).toHaveLength(4);
      expect(result.toSkip).toHaveLength(1);

      // スキップされるのは BTCUSDT の最低優先度
      expect(result.toSkip[0].noteId).toBe('note-3');
    });

    it('groupBySymbol=false の場合は全体で制限', async () => {
      const hits = [
        createHit('note-1', 'BTCUSDT', 0.90, 10),
        createHit('note-2', 'BTCUSDT', 0.85, 9),
        createHit('note-3', 'ETHUSDT', 0.88, 8),
        createHit('note-4', 'ETHUSDT', 0.82, 7),
      ];

      const config: BatchConfig = {
        maxSimultaneous: 2,
        groupBySymbol: false,
        cooldownMinutes: 15,
      };

      const result = await service.control(hits, config);

      // 全体で2件のみ通知
      expect(result.toNotify).toHaveLength(2);
      expect(result.toSkip).toHaveLength(2);
    });
  });

  describe('control - 空入力', () => {
    it('空配列の場合は空の結果を返す', async () => {
      const result = await service.control([], {
        maxSimultaneous: 3,
        groupBySymbol: true,
        cooldownMinutes: 15,
      });

      expect(result.toNotify).toHaveLength(0);
      expect(result.toSkip).toHaveLength(0);
      expect(result.groupedBySymbol.size).toBe(0);
    });
  });

  describe('getActiveConfig', () => {
    it('アクティブな設定を返す', async () => {
      (mockPrismaClient.notificationBatchConfig.findFirst as jest.Mock).mockResolvedValue({
        maxSimultaneous: 5,
        groupBySymbol: false,
        cooldownMinutes: 30,
        active: true,
      });

      const config = await service.getActiveConfig();

      expect(config.maxSimultaneous).toBe(5);
      expect(config.groupBySymbol).toBe(false);
      expect(config.cooldownMinutes).toBe(30);
    });

    it('設定がない場合はデフォルト値を返す', async () => {
      (mockPrismaClient.notificationBatchConfig.findFirst as jest.Mock).mockResolvedValue(null);

      const config = await service.getActiveConfig();

      expect(config.maxSimultaneous).toBe(3);
      expect(config.groupBySymbol).toBe(true);
      expect(config.cooldownMinutes).toBe(15);
    });
  });

  describe('logSkippedHits', () => {
    it('スキップログを記録する', async () => {
      (mockPrismaClient.notificationSkipLog.createMany as jest.Mock).mockResolvedValue({ count: 2 });

      const skippedHits = [
        createHit('note-4', 'BTCUSDT', 0.70, 7),
        createHit('note-5', 'BTCUSDT', 0.65, 6),
      ];

      await service.logSkippedHits(skippedHits, 5, 'max_simultaneous_exceeded');

      expect(mockPrismaClient.notificationSkipLog.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({
            noteId: 'note-4',
            reason: 'max_simultaneous_exceeded',
            details: expect.objectContaining({
              simultaneousCount: 5,
            }),
          }),
          expect.objectContaining({
            noteId: 'note-5',
            reason: 'max_simultaneous_exceeded',
            details: expect.objectContaining({
              simultaneousCount: 5,
            }),
          }),
        ]),
      });
    });

    it('空配列の場合は何もしない', async () => {
      await service.logSkippedHits([], 0, 'max_simultaneous_exceeded');

      expect(mockPrismaClient.notificationSkipLog.createMany).not.toHaveBeenCalled();
    });
  });

  describe('generateGroupedMessage', () => {
    it('単一ヒットのメッセージを生成', async () => {
      const hits = [createHit('note-1', 'BTCUSDT', 0.85, 10)];

      const message = await service.generateGroupedMessage(hits);

      expect(message).toBe('BTCUSDT: 85%');
    });

    it('複数ヒットのまとめメッセージを生成', async () => {
      const hits = [
        createHit('note-1', 'BTCUSDT', 0.85, 10),
        createHit('note-2', 'BTCUSDT', 0.78, 9),
      ];

      const message = await service.generateGroupedMessage(hits);

      expect(message).toBe('BTCUSDT: 85%, 78%');
    });

    it('空配列の場合は空文字を返す', async () => {
      const message = await service.generateGroupedMessage([]);

      expect(message).toBe('');
    });
  });
});
