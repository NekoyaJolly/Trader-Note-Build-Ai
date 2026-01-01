/**
 * EvaluationLogRepository テスト
 * 
 * 目的:
 * - upsertLog の冪等性検証
 * - search の各種フィルタ検証
 * - getPerformanceSummary の集計検証
 * 
 * @see docs/ARCHITECTURE.md - NoteEvaluator アーキテクチャ
 */

import { PrismaClient } from '@prisma/client';
import { 
  EvaluationLogRepository, 
  EvaluationLogCreateInput,
  NotePerformanceSummary
} from '../repositories/evaluationLogRepository';
import { EvaluationResult } from '../../domain/noteEvaluator';

// モック用 Prisma クライアント
const mockPrismaClient = {
  evaluationLog: {
    upsert: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    aggregate: jest.fn(),
    deleteMany: jest.fn(),
  },
} as unknown as PrismaClient;

describe('EvaluationLogRepository', () => {
  let repository: EvaluationLogRepository;

  // テスト用データ
  const testEvaluationResult: EvaluationResult = {
    noteId: 'note-123',
    similarity: 0.85,
    level: 'strong',
    triggered: true,
    vectorDimension: 6,
    usedIndicators: ['rsi_14', 'macd_12_26_9', 'bb_20_2'],
    evaluatedAt: new Date('2025-01-01T12:00:00Z'),
    diagnostics: {
      noteVector: [0.3, 0.5, 0.2, 0.4, 0.6, 0.3],
      marketVector: [0.35, 0.48, 0.22, 0.38, 0.58, 0.32],
      missingIndicators: [],
    },
  };

  const testInput: EvaluationLogCreateInput = {
    noteId: 'note-123',
    marketSnapshotId: 'snapshot-456',
    symbol: 'BTCUSDT',
    timeframe: '15m',
    evaluationResult: testEvaluationResult,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    repository = new EvaluationLogRepository(mockPrismaClient);
  });

  describe('upsertLog', () => {
    it('新規評価ログを作成できる', async () => {
      // モックの戻り値設定
      const expectedLog = {
        id: 'log-789',
        noteId: testInput.noteId,
        marketSnapshotId: testInput.marketSnapshotId,
        symbol: testInput.symbol,
        timeframe: testInput.timeframe,
        similarity: testEvaluationResult.similarity,
        level: testEvaluationResult.level,
        triggered: testEvaluationResult.triggered,
        vectorDimension: testEvaluationResult.vectorDimension,
        usedIndicators: testEvaluationResult.usedIndicators,
        diagnostics: null,
        evaluatedAt: testEvaluationResult.evaluatedAt,
        createdAt: new Date(),
      };
      (mockPrismaClient.evaluationLog.upsert as jest.Mock).mockResolvedValue(expectedLog);

      // 実行
      const result = await repository.upsertLog(testInput);

      // 検証
      expect(result).toEqual(expectedLog);
      expect(mockPrismaClient.evaluationLog.upsert).toHaveBeenCalledTimes(1);
      expect(mockPrismaClient.evaluationLog.upsert).toHaveBeenCalledWith({
        where: {
          noteId_marketSnapshotId_timeframe: {
            noteId: testInput.noteId,
            marketSnapshotId: testInput.marketSnapshotId,
            timeframe: testInput.timeframe,
          },
        },
        create: expect.objectContaining({
          noteId: testInput.noteId,
          marketSnapshotId: testInput.marketSnapshotId,
          symbol: testInput.symbol,
          timeframe: testInput.timeframe,
          similarity: testEvaluationResult.similarity,
          level: testEvaluationResult.level,
          triggered: testEvaluationResult.triggered,
          vectorDimension: testEvaluationResult.vectorDimension,
          usedIndicators: testEvaluationResult.usedIndicators,
        }),
        update: expect.objectContaining({
          similarity: testEvaluationResult.similarity,
          level: testEvaluationResult.level,
          triggered: testEvaluationResult.triggered,
        }),
      });
    });

    it('同じ noteId × marketSnapshotId × timeframe は更新される（冪等性）', async () => {
      // 1回目の呼び出し
      const firstLog = {
        id: 'log-789',
        similarity: 0.85,
        triggered: true,
      };
      (mockPrismaClient.evaluationLog.upsert as jest.Mock).mockResolvedValue(firstLog);
      await repository.upsertLog(testInput);

      // 2回目の呼び出し（同じキー、異なる値）
      const updatedResult: EvaluationResult = {
        ...testEvaluationResult,
        similarity: 0.90,
      };
      const updatedInput: EvaluationLogCreateInput = {
        ...testInput,
        evaluationResult: updatedResult,
      };
      const secondLog = {
        id: 'log-789', // 同じID（更新される）
        similarity: 0.90,
        triggered: true,
      };
      (mockPrismaClient.evaluationLog.upsert as jest.Mock).mockResolvedValue(secondLog);
      await repository.upsertLog(updatedInput);

      // upsert が2回呼ばれ、2回目は更新されている
      expect(mockPrismaClient.evaluationLog.upsert).toHaveBeenCalledTimes(2);
    });

    it('saveDiagnostics=true で診断情報が保存される', async () => {
      const inputWithDiagnostics: EvaluationLogCreateInput = {
        ...testInput,
        saveDiagnostics: true,
      };
      (mockPrismaClient.evaluationLog.upsert as jest.Mock).mockResolvedValue({});

      await repository.upsertLog(inputWithDiagnostics);

      // diagnostics が含まれていることを確認
      expect(mockPrismaClient.evaluationLog.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            diagnostics: testEvaluationResult.diagnostics,
          }),
        })
      );
    });
  });

  describe('exists', () => {
    it('ログが存在する場合は true を返す', async () => {
      (mockPrismaClient.evaluationLog.findUnique as jest.Mock).mockResolvedValue({ id: 'log-789' });

      const result = await repository.exists('note-123', 'snapshot-456', '15m');

      expect(result).toBe(true);
      expect(mockPrismaClient.evaluationLog.findUnique).toHaveBeenCalledWith({
        where: {
          noteId_marketSnapshotId_timeframe: {
            noteId: 'note-123',
            marketSnapshotId: 'snapshot-456',
            timeframe: '15m',
          },
        },
        select: { id: true },
      });
    });

    it('ログが存在しない場合は false を返す', async () => {
      (mockPrismaClient.evaluationLog.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await repository.exists('note-123', 'snapshot-456', '15m');

      expect(result).toBe(false);
    });
  });

  describe('search', () => {
    it('noteId で絞り込める', async () => {
      const logs = [{ id: 'log-1' }, { id: 'log-2' }];
      (mockPrismaClient.evaluationLog.findMany as jest.Mock).mockResolvedValue(logs);

      const result = await repository.search({ noteId: 'note-123' });

      expect(result).toEqual(logs);
      expect(mockPrismaClient.evaluationLog.findMany).toHaveBeenCalledWith({
        where: { noteId: 'note-123' },
        orderBy: { evaluatedAt: 'desc' },
        take: 100,
        skip: 0,
      });
    });

    it('triggeredOnly=true で発火ログのみ取得', async () => {
      const triggeredLogs = [{ id: 'log-1', triggered: true }];
      (mockPrismaClient.evaluationLog.findMany as jest.Mock).mockResolvedValue(triggeredLogs);

      const result = await repository.search({ triggeredOnly: true });

      expect(result).toEqual(triggeredLogs);
      expect(mockPrismaClient.evaluationLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { triggered: true },
        })
      );
    });

    it('日時範囲で絞り込める', async () => {
      const logs = [{ id: 'log-1' }];
      (mockPrismaClient.evaluationLog.findMany as jest.Mock).mockResolvedValue(logs);

      const from = new Date('2025-01-01T00:00:00Z');
      const to = new Date('2025-01-02T00:00:00Z');
      await repository.search({ evaluatedFrom: from, evaluatedTo: to });

      expect(mockPrismaClient.evaluationLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            evaluatedAt: { gte: from, lte: to },
          },
        })
      );
    });

    it('limit と offset でページネーション', async () => {
      (mockPrismaClient.evaluationLog.findMany as jest.Mock).mockResolvedValue([]);

      await repository.search({ limit: 10, offset: 20 });

      expect(mockPrismaClient.evaluationLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 10,
          skip: 20,
        })
      );
    });
  });

  describe('getPerformanceSummary', () => {
    it('ノートのパフォーマンス集計を取得できる', async () => {
      // aggregate の戻り値
      (mockPrismaClient.evaluationLog.aggregate as jest.Mock).mockResolvedValue({
        _count: { id: 100 },
        _avg: { similarity: 0.72 },
        _max: { similarity: 0.95, evaluatedAt: new Date('2025-01-10T12:00:00Z') },
        _min: { similarity: 0.35 },
      });
      // triggered カウント
      (mockPrismaClient.evaluationLog.count as jest.Mock).mockResolvedValue(15);

      const result = await repository.getPerformanceSummary('note-123');

      expect(result).toEqual<NotePerformanceSummary>({
        noteId: 'note-123',
        totalEvaluations: 100,
        triggeredCount: 15,
        triggerRate: 0.15,
        avgSimilarity: 0.72,
        maxSimilarity: 0.95,
        minSimilarity: 0.35,
        lastEvaluatedAt: new Date('2025-01-10T12:00:00Z'),
      });
    });

    it('評価ログがない場合は null を返す', async () => {
      (mockPrismaClient.evaluationLog.aggregate as jest.Mock).mockResolvedValue({
        _count: { id: 0 },
        _avg: { similarity: null },
        _max: { similarity: null, evaluatedAt: null },
        _min: { similarity: null },
      });

      const result = await repository.getPerformanceSummary('note-nonexistent');

      expect(result).toBeNull();
    });

    it('triggerRate が正しく計算される（発火0件の場合）', async () => {
      (mockPrismaClient.evaluationLog.aggregate as jest.Mock).mockResolvedValue({
        _count: { id: 50 },
        _avg: { similarity: 0.40 },
        _max: { similarity: 0.55, evaluatedAt: new Date() },
        _min: { similarity: 0.25 },
      });
      (mockPrismaClient.evaluationLog.count as jest.Mock).mockResolvedValue(0);

      const result = await repository.getPerformanceSummary('note-123');

      expect(result?.triggerRate).toBe(0);
      expect(result?.triggeredCount).toBe(0);
      expect(result?.totalEvaluations).toBe(50);
    });
  });

  describe('getTriggeredLogs', () => {
    it('発火ログを取得できる', async () => {
      const logs = [
        { id: 'log-1', triggered: true },
        { id: 'log-2', triggered: true },
      ];
      (mockPrismaClient.evaluationLog.findMany as jest.Mock).mockResolvedValue(logs);

      const result = await repository.getTriggeredLogs({ noteId: 'note-123' });

      expect(result).toEqual(logs);
      expect(mockPrismaClient.evaluationLog.findMany).toHaveBeenCalledWith({
        where: { triggered: true, noteId: 'note-123' },
        orderBy: { evaluatedAt: 'desc' },
        take: 100,
      });
    });
  });

  describe('deleteOldLogs', () => {
    it('古いログを削除できる', async () => {
      (mockPrismaClient.evaluationLog.deleteMany as jest.Mock).mockResolvedValue({ count: 50 });

      const olderThan = new Date('2024-01-01T00:00:00Z');
      const result = await repository.deleteOldLogs(olderThan);

      expect(result).toBe(50);
      expect(mockPrismaClient.evaluationLog.deleteMany).toHaveBeenCalledWith({
        where: {
          evaluatedAt: { lt: olderThan },
        },
      });
    });
  });
});
