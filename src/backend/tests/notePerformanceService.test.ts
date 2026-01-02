/**
 * NotePerformanceService のユニットテスト
 * 
 * フェーズ9「ノートの自己評価」
 * 集計ロジック、時間帯別/相場状況別パフォーマンス、弱いパターン検出をテスト
 */

import { NotePerformanceService } from '../../services/performance/notePerformanceService';
import {
  NotePerformanceReport,
  NoteRankingEntry,
  HourlyPerformance,
  MarketCondition,
} from '../../services/performance/notePerformanceTypes';

// Prisma モック
const mockPrisma = {
  evaluationLog: {
    findMany: jest.fn(),
    aggregate: jest.fn(),
    count: jest.fn(),
  },
  tradeNote: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
  },
};

describe('NotePerformanceService', () => {
  let service: NotePerformanceService;

  beforeEach(() => {
    jest.clearAllMocks();
    // モックPrismaClientでサービスを初期化
    service = new NotePerformanceService(mockPrisma as never);
  });

  describe('generateReport', () => {
    const mockNoteId = 'note-123';
    const mockSymbol = 'BTCUSDT';

    it('評価ログがない場合は null を返す', async () => {
      mockPrisma.evaluationLog.findMany.mockResolvedValue([]);

      const result = await service.generateReport(mockNoteId);

      expect(result).toBeNull();
    });

    it('基本統計を正しく計算する', async () => {
      // モックデータ: 10件の評価ログ、4件が triggered
      const mockLogs = createMockLogs(10, 4);
      mockPrisma.evaluationLog.findMany.mockResolvedValue(mockLogs);
      mockPrisma.tradeNote.findUnique.mockResolvedValue({ symbol: mockSymbol });

      const result = await service.generateReport(mockNoteId);

      expect(result).not.toBeNull();
      expect(result!.noteId).toBe(mockNoteId);
      expect(result!.symbol).toBe(mockSymbol);
      expect(result!.totalEvaluations).toBe(10);
      expect(result!.triggeredCount).toBe(4);
      expect(result!.triggerRate).toBeCloseTo(0.4, 2);
    });

    it('時間帯別パフォーマンスを24時間分返す', async () => {
      const mockLogs = createMockLogs(24, 12); // 24件、12件 triggered
      mockPrisma.evaluationLog.findMany.mockResolvedValue(mockLogs);
      mockPrisma.tradeNote.findUnique.mockResolvedValue({ symbol: mockSymbol });

      const result = await service.generateReport(mockNoteId);

      expect(result!.performanceByHour).toHaveLength(24);
      
      // 各時間帯がカバーされている
      const hours = result!.performanceByHour.map(h => h.hour);
      for (let i = 0; i < 24; i++) {
        expect(hours).toContain(i);
      }
    });

    it('相場状況別パフォーマンスを4種類返す', async () => {
      const mockLogs = createMockLogs(20, 10);
      mockPrisma.evaluationLog.findMany.mockResolvedValue(mockLogs);
      mockPrisma.tradeNote.findUnique.mockResolvedValue({ symbol: mockSymbol });

      const result = await service.generateReport(mockNoteId);

      expect(result!.performanceByMarketCondition).toHaveLength(4);
      
      const conditions = result!.performanceByMarketCondition.map(c => c.condition);
      expect(conditions).toContain('trending_up');
      expect(conditions).toContain('trending_down');
      expect(conditions).toContain('ranging');
      expect(conditions).toContain('volatile');
    });

    it('弱いパターンを検出する', async () => {
      // 低類似度のログを多く含むモックデータ
      const mockLogs = createMockLogsWithWeakPatterns();
      mockPrisma.evaluationLog.findMany.mockResolvedValue(mockLogs);
      mockPrisma.tradeNote.findUnique.mockResolvedValue({ symbol: mockSymbol });

      const result = await service.generateReport(mockNoteId, { weakThreshold: 0.5 });

      // 弱いパターンが検出されること
      expect(result!.weakPatterns.length).toBeGreaterThan(0);
      
      // 各パターンに必要な情報が含まれる
      for (const pattern of result!.weakPatterns) {
        expect(pattern.description).toBeTruthy();
        expect(pattern.occurrences).toBeGreaterThan(0);
        expect(typeof pattern.avgSimilarity).toBe('number');
      }
    });

    it('期間指定で集計をフィルタリングする', async () => {
      const mockLogs = createMockLogs(10, 5);
      mockPrisma.evaluationLog.findMany.mockResolvedValue(mockLogs);
      mockPrisma.tradeNote.findUnique.mockResolvedValue({ symbol: mockSymbol });

      const from = new Date('2026-01-01');
      const to = new Date('2026-01-31');

      await service.generateReport(mockNoteId, { from, to });

      // findMany が期間フィルタ付きで呼ばれていることを確認
      expect(mockPrisma.evaluationLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            noteId: mockNoteId,
            evaluatedAt: expect.objectContaining({
              gte: from,
              lte: to,
            }),
          }),
        })
      );
    });
  });

  describe('getRanking', () => {
    it('アクティブなノートのランキングを返す', async () => {
      // モックノート
      const mockNotes = [
        { id: 'note-1', symbol: 'BTCUSDT' },
        { id: 'note-2', symbol: 'ETHUSDT' },
        { id: 'note-3', symbol: 'XRPUSDT' },
      ];
      mockPrisma.tradeNote.findMany.mockResolvedValue(mockNotes);

      // 各ノートの評価ログ
      mockPrisma.evaluationLog.findMany
        .mockResolvedValueOnce(createMockLogs(20, 15)) // note-1: 高パフォーマンス
        .mockResolvedValueOnce(createMockLogs(15, 5))  // note-2: 中パフォーマンス
        .mockResolvedValueOnce(createMockLogs(10, 2)); // note-3: 低パフォーマンス

      const result = await service.getRanking(10);

      expect(result).toHaveLength(3);
      
      // スコア順にソートされている
      for (let i = 1; i < result.length; i++) {
        expect(result[i - 1].overallScore).toBeGreaterThanOrEqual(result[i].overallScore);
      }

      // ランクが正しく設定されている
      expect(result[0].rank).toBe(1);
      expect(result[1].rank).toBe(2);
      expect(result[2].rank).toBe(3);
    });

    it('評価回数が足りないノートはスキップする', async () => {
      const mockNotes = [
        { id: 'note-1', symbol: 'BTCUSDT' },
        { id: 'note-2', symbol: 'ETHUSDT' }, // 評価回数 < 5
      ];
      mockPrisma.tradeNote.findMany.mockResolvedValue(mockNotes);

      mockPrisma.evaluationLog.findMany
        .mockResolvedValueOnce(createMockLogs(20, 10))
        .mockResolvedValueOnce(createMockLogs(3, 1)); // 5件未満

      const result = await service.getRanking(10);

      expect(result).toHaveLength(1);
      expect(result[0].noteId).toBe('note-1');
    });

    it('limit で件数を制限する', async () => {
      const mockNotes = Array.from({ length: 10 }, (_, i) => ({
        id: `note-${i}`,
        symbol: 'BTCUSDT',
      }));
      mockPrisma.tradeNote.findMany.mockResolvedValue(mockNotes);

      // 全ノートに十分な評価ログ
      for (let i = 0; i < 10; i++) {
        mockPrisma.evaluationLog.findMany.mockResolvedValueOnce(createMockLogs(20, 10));
      }

      const result = await service.getRanking(5);

      expect(result).toHaveLength(5);
    });
  });

  describe('getBulkSummary', () => {
    it('複数ノートのサマリーを返す', async () => {
      const noteIds = ['note-1', 'note-2'];

      mockPrisma.evaluationLog.findMany
        .mockResolvedValueOnce(createMockLogs(10, 5))
        .mockResolvedValueOnce(createMockLogs(8, 4));

      const result = await service.getBulkSummary(noteIds);

      expect(result.size).toBe(2);
      expect(result.has('note-1')).toBe(true);
      expect(result.has('note-2')).toBe(true);

      const note1Summary = result.get('note-1')!;
      expect(note1Summary.totalEvaluations).toBe(10);
      expect(note1Summary.triggerRate).toBeCloseTo(0.5, 2);
    });

    it('評価ログがないノートは結果に含まれない', async () => {
      const noteIds = ['note-1', 'note-2'];

      mockPrisma.evaluationLog.findMany
        .mockResolvedValueOnce(createMockLogs(10, 5))
        .mockResolvedValueOnce([]); // note-2 は評価ログなし

      const result = await service.getBulkSummary(noteIds);

      expect(result.size).toBe(1);
      expect(result.has('note-1')).toBe(true);
      expect(result.has('note-2')).toBe(false);
    });
  });
});

// ========================================
// ヘルパー関数
// ========================================

/**
 * モック評価ログを生成
 */
function createMockLogs(total: number, triggered: number) {
  const logs = [];
  
  for (let i = 0; i < total; i++) {
    const isTriggered = i < triggered;
    const hour = i % 24;
    
    logs.push({
      id: `log-${i}`,
      noteId: 'note-123',
      marketSnapshotId: `snapshot-${i}`,
      symbol: 'BTCUSDT',
      timeframe: '15m',
      similarity: isTriggered ? 0.7 + Math.random() * 0.3 : 0.3 + Math.random() * 0.3,
      level: isTriggered ? 'strong' : 'weak',
      triggered: isTriggered,
      vectorDimension: 12,
      usedIndicators: ['RSI(14)', 'SMA(20)'],
      diagnostics: {
        trend: i % 3 === 0 ? 'bullish' : i % 3 === 1 ? 'bearish' : 'neutral',
      },
      evaluatedAt: new Date(2026, 0, 1, hour, 0, 0),
      createdAt: new Date(),
    });
  }
  
  return logs;
}

/**
 * 弱いパターンを含むモックログを生成
 */
function createMockLogsWithWeakPatterns() {
  const logs = [];
  
  // 通常のログ（類似度 0.6-0.9）
  for (let i = 0; i < 10; i++) {
    logs.push({
      id: `log-normal-${i}`,
      noteId: 'note-123',
      marketSnapshotId: `snapshot-${i}`,
      symbol: 'BTCUSDT',
      timeframe: '15m',
      similarity: 0.6 + Math.random() * 0.3,
      level: 'medium',
      triggered: true,
      vectorDimension: 12,
      usedIndicators: ['RSI(14)'],
      diagnostics: { trend: 'bullish' },
      evaluatedAt: new Date(2026, 0, 1, 10, 0, 0),
      createdAt: new Date(),
    });
  }
  
  // ボラタイル時の弱いログ（類似度 0.2-0.4）
  for (let i = 0; i < 5; i++) {
    logs.push({
      id: `log-weak-volatile-${i}`,
      noteId: 'note-123',
      marketSnapshotId: `snapshot-volatile-${i}`,
      symbol: 'BTCUSDT',
      timeframe: '15m',
      similarity: 0.2 + Math.random() * 0.2,
      level: 'none',
      triggered: false,
      vectorDimension: 12,
      usedIndicators: ['RSI(14)'],
      diagnostics: {
        marketCondition: {
          atr: 100,
          atrAvg: 50, // ATR が平均の2倍 → volatile
          priceChangePercent: 3,
        },
      },
      evaluatedAt: new Date(2026, 0, 1, 14, 0, 0),
      createdAt: new Date(),
    });
  }
  
  // 特定時間帯（UTC 3時）に集中した弱いログ
  for (let i = 0; i < 5; i++) {
    logs.push({
      id: `log-weak-hour-${i}`,
      noteId: 'note-123',
      marketSnapshotId: `snapshot-hour-${i}`,
      symbol: 'BTCUSDT',
      timeframe: '15m',
      similarity: 0.3 + Math.random() * 0.15,
      level: 'weak',
      triggered: false,
      vectorDimension: 12,
      usedIndicators: ['RSI(14)'],
      diagnostics: { trend: 'neutral' },
      evaluatedAt: new Date(2026, 0, 1, 3, 0, 0), // UTC 3時
      createdAt: new Date(),
    });
  }
  
  return logs;
}
