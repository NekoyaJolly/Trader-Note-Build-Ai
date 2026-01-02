/**
 * トレードノート生成サービスのテスト
 * 
 * テスト観点:
 * - ノート生成の正常系
 * - DB への永続化
 * - 特徴量と AI 要約の統合
 */

import { TradeNoteGeneratorService } from '../../services/note-generator/tradeNoteGeneratorService';
import { TradeNoteRepository } from '../../backend/repositories/tradeNoteRepository';
import { AISummaryService } from '../../services/aiSummaryService';
import { FeatureExtractor, MarketContext } from '../../services/note-generator/featureExtractor';
import { DecisionInferenceService } from '../../services/inference/decisionInferenceService';
import { Trade, TradeSide, Prisma, NoteStatus } from '@prisma/client';

// モックを作成
jest.mock('../../backend/repositories/tradeNoteRepository');
jest.mock('../../services/aiSummaryService');
jest.mock('../../services/note-generator/featureExtractor');
jest.mock('../../services/inference/decisionInferenceService');

/**
 * TradeNoteWithSummary のデフォルトフィールドを追加するヘルパー
 * Phase 8 で追加された status, activatedAt 等の必須フィールドを含む
 */
const createMockNoteWithSummary = (overrides?: Record<string, unknown>) => ({
  id: 'test-note-id',
  tradeId: 'test-trade-id',
  symbol: 'BTCUSD',
  entryPrice: new Prisma.Decimal(50000),
  side: TradeSide.buy,
  featureVector: [0.02, 0.5, 0.65, 0.05, 1, 0.02, 0],
  indicators: {},
  timeframe: '15m',
  createdAt: new Date(),
  updatedAt: new Date(),
  // Phase 8: 追加フィールド
  status: 'draft' as NoteStatus,
  activatedAt: null,
  archivedAt: null,
  lastEditedAt: null,
  marketContext: null,
  userNotes: null,
  tags: [],
  // フェーズ8: 優先度/有効無効管理
  indicatorConfig: null,
  priority: 5,
  enabled: true,
  pausedUntil: null,
  aiSummary: {
    id: 'test-summary-id',
    noteId: 'test-note-id',
    summary: 'テスト要約',
    promptTokens: 100,
    completionTokens: 50,
    model: 'test-model',
    createdAt: new Date(),
  },
  ...overrides,
});

// モックを作成
jest.mock('../../backend/repositories/tradeNoteRepository');
jest.mock('../../services/aiSummaryService');
jest.mock('../../services/note-generator/featureExtractor');
jest.mock('../../services/inference/decisionInferenceService');

describe('TradeNoteGeneratorService', () => {
  let service: TradeNoteGeneratorService;
  let mockRepository: jest.Mocked<TradeNoteRepository>;
  let mockAIService: jest.Mocked<AISummaryService>;
  let mockFeatureExtractor: jest.Mocked<FeatureExtractor>;
  let mockInferenceService: jest.Mocked<DecisionInferenceService>;

  // テスト用のモックトレードデータ
  const createMockTrade = (overrides?: Partial<Trade>): Trade => ({
    id: 'test-trade-id',
    timestamp: new Date('2025-12-26T10:00:00Z'),
    symbol: 'BTCUSD',
    side: TradeSide.buy,
    price: new Prisma.Decimal(50000),
    quantity: new Prisma.Decimal(1.5),
    fee: null,
    exchange: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(() => {
    // モックをリセット
    jest.clearAllMocks();

    // モックリポジトリのセットアップ
    mockRepository = new TradeNoteRepository() as jest.Mocked<TradeNoteRepository>;
    mockRepository.createWithSummary = jest.fn().mockResolvedValue(createMockNoteWithSummary());

    // モック AI サービスのセットアップ
    mockAIService = new AISummaryService() as jest.Mocked<AISummaryService>;
    mockAIService.generateTradeSummary = jest.fn().mockResolvedValue({
      summary: 'テスト要約',
      promptTokens: 100,
      completionTokens: 50,
      model: 'test-model',
    });

    // モック特徴量抽出サービスのセットアップ
    mockFeatureExtractor = new FeatureExtractor() as jest.Mocked<FeatureExtractor>;
    mockFeatureExtractor.extractFeatures = jest.fn().mockReturnValue({
      values: [0.02, 0.5, 0.65, 0.05, 1, 0.02, 0],
      version: '1.0.0',
    });

    // モック推定サービスのセットアップ
    mockInferenceService = new DecisionInferenceService() as jest.Mocked<DecisionInferenceService>;
    mockInferenceService.infer = jest.fn().mockResolvedValue({
      primaryTimeframe: '15m',
      secondaryTimeframes: ['60m'],
      inferredMode: 'trend',
      rationale: 'テスト推定',
    });

    // サービスをモックと共にインスタンス化
    service = new TradeNoteGeneratorService(
      mockRepository,
      mockAIService,
      mockFeatureExtractor,
      mockInferenceService
    );
  });

  describe('generateAndSaveNote', () => {
    test('トレードからノートを生成し、DB に保存できる', async () => {
      const trade = createMockTrade();
      const marketContext: MarketContext = {
        previousClose: 49000,
        rsi: 65,
        macd: 0.5,
        timeframe: '15m',
      };

      const result = await service.generateAndSaveNote(trade, marketContext);

      // 特徴量抽出が呼ばれたことを確認
      expect(mockFeatureExtractor.extractFeatures).toHaveBeenCalledWith(trade, marketContext);

      // AI 要約が呼ばれたことを確認
      expect(mockAIService.generateTradeSummary).toHaveBeenCalledWith(
        expect.objectContaining({
          symbol: 'BTCUSD',
          side: 'buy',
          price: 50000,
          quantity: 1.5,
        })
      );

      // リポジトリが呼ばれたことを確認
      expect(mockRepository.createWithSummary).toHaveBeenCalledWith(
        expect.objectContaining({
          tradeId: 'test-trade-id',
          symbol: 'BTCUSD',
          entryPrice: 50000,
          side: TradeSide.buy,
          timeframe: '15m',
        }),
        expect.objectContaining({
          summary: 'テスト要約',
        })
      );

      // 結果を検証
      expect(result.noteId).toBe('test-note-id');
      expect(result.tradeId).toBe('test-trade-id');
      expect(result.summary).toBe('テスト要約');
      expect(result.featureVector).toEqual([0.02, 0.5, 0.65, 0.05, 1, 0.02, 0]);
      expect(result.tokenUsage?.promptTokens).toBe(100);
      expect(result.tokenUsage?.completionTokens).toBe(50);
      expect(result.inference?.primaryTimeframe).toBe('15m');
    });

    test('市場コンテキストなしでもノートを生成できる', async () => {
      const trade = createMockTrade();

      const result = await service.generateAndSaveNote(trade);

      // 特徴量抽出が呼ばれたことを確認 (marketContext は undefined)
      expect(mockFeatureExtractor.extractFeatures).toHaveBeenCalledWith(trade, undefined);

      // 推定結果がインジケータに含まれることを確認
      expect(mockRepository.createWithSummary).toHaveBeenCalledWith(
        expect.objectContaining({
          tradeId: 'test-trade-id',
          indicators: expect.objectContaining({ inferredMode: 'trend' }),
          timeframe: '15m',
        }),
        expect.any(Object)
      );

      expect(result.noteId).toBe('test-note-id');
      expect(result.inference?.inferredMode).toBe('trend');
    });

    test('売り注文でもノートを生成できる', async () => {
      const trade = createMockTrade({ side: TradeSide.sell });

      await service.generateAndSaveNote(trade);

      expect(mockRepository.createWithSummary).toHaveBeenCalledWith(
        expect.objectContaining({
          side: TradeSide.sell,
        }),
        expect.any(Object)
      );
    });
  });

  describe('batchGenerateNotes', () => {
    test('複数のトレードからノートを一括生成できる', async () => {
      const trades = [
        createMockTrade({ id: 'trade-1' }),
        createMockTrade({ id: 'trade-2' }),
        createMockTrade({ id: 'trade-3' }),
      ];

      // 各トレードに対して異なるノート ID を返すよう設定
      mockRepository.createWithSummary
        .mockResolvedValueOnce(createMockNoteWithSummary({
          id: 'note-1',
          tradeId: 'trade-1',
          aiSummary: {
            id: 'summary-1',
            noteId: 'note-1',
            summary: 'テスト要約1',
            promptTokens: 100,
            completionTokens: 50,
            model: 'test-model',
            createdAt: new Date(),
          },
        }))
        .mockResolvedValueOnce(createMockNoteWithSummary({
          id: 'note-2',
          tradeId: 'trade-2',
          aiSummary: {
            id: 'summary-2',
            noteId: 'note-2',
            summary: 'テスト要約2',
            promptTokens: 100,
            completionTokens: 50,
            model: 'test-model',
            createdAt: new Date(),
          },
        }))
        .mockResolvedValueOnce(createMockNoteWithSummary({
          id: 'note-3',
          tradeId: 'trade-3',
          aiSummary: {
            id: 'summary-3',
            noteId: 'note-3',
            summary: 'テスト要約3',
            promptTokens: 100,
            completionTokens: 50,
            model: 'test-model',
            createdAt: new Date(),
          },
        }));

      const results = await service.batchGenerateNotes(trades);

      // 3 件のノートが生成されたことを確認
      expect(results).toHaveLength(3);
      expect(results[0].noteId).toBe('note-1');
      expect(results[1].noteId).toBe('note-2');
      expect(results[2].noteId).toBe('note-3');
    });

    test('エラーが発生してもスキップして続行する', async () => {
      const trades = [
        createMockTrade({ id: 'trade-1' }),
        createMockTrade({ id: 'trade-2' }),
        createMockTrade({ id: 'trade-3' }),
      ];

      // 2 番目のトレードでエラーを発生させる
      mockRepository.createWithSummary
        .mockResolvedValueOnce(createMockNoteWithSummary({
          id: 'note-1',
          tradeId: 'trade-1',
          aiSummary: {
            id: 'summary-1',
            noteId: 'note-1',
            summary: 'テスト要約1',
            promptTokens: 100,
            completionTokens: 50,
            model: 'test-model',
            createdAt: new Date(),
          },
        }))
        .mockRejectedValueOnce(new Error('DB エラー'))
        .mockResolvedValueOnce(createMockNoteWithSummary({
          id: 'note-3',
          tradeId: 'trade-3',
          aiSummary: {
            id: 'summary-3',
            noteId: 'note-3',
            summary: 'テスト要約3',
            promptTokens: 100,
            completionTokens: 50,
            model: 'test-model',
            createdAt: new Date(),
          },
        }));

      const results = await service.batchGenerateNotes(trades);

      // エラーが発生したトレードはスキップされ、2 件のみ成功
      expect(results).toHaveLength(2);
      expect(results[0].noteId).toBe('note-1');
      expect(results[1].noteId).toBe('note-3');
    });
  });
});
