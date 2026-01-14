/**
 * 横断類似ノート検索サービステスト
 * 
 * CrossSimilarityService の動作検証
 * 
 * テスト内容:
 * - 特徴ベクトルからの検索
 * - OHLCVデータからの検索
 * - Side-A/Side-B 結果マージ
 * - フィルタリング・ソート
 */

import { CrossSimilarityService } from '../../services/crossSimilarityService';
import { PrismaClient } from '@prisma/client';
import type { OHLCVData } from '../../schemas/api/similarity';

const prisma = new PrismaClient();

describe('CrossSimilarityService', () => {
  let service: CrossSimilarityService;
  
  // リモートDB接続のためタイムアウトを延長
  jest.setTimeout(30000);

  beforeAll(() => {
    service = new CrossSimilarityService();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // テスト用OHLCVデータ生成
  const generateTestOHLCV = (basePrice: number = 100, count: number = 20): OHLCVData[] => {
    const data: OHLCVData[] = [];
    const baseTime = new Date('2024-01-01T00:00:00Z');
    
    for (let i = 0; i < count; i++) {
      const variation = (Math.random() - 0.5) * 5;
      const open = basePrice + variation;
      const close = open + (Math.random() - 0.5) * 3;
      const high = Math.max(open, close) + Math.random() * 2;
      const low = Math.min(open, close) - Math.random() * 2;
      
      data.push({
        timestamp: new Date(baseTime.getTime() + i * 3600000),
        open,
        high,
        low,
        close,
        volume: 1000 + Math.random() * 500,
      });
    }
    
    return data;
  };

  describe('基本検索機能', () => {
    it('特徴ベクトルからの検索が動作する', async () => {
      const testVector = [0.5, 0.6, 0.7, 0.4, 0.5, 0.6, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
      
      const result = await service.searchSimilarNotes({
        featureVector: testVector,
        topK: 5,
        minSimilarity: 0.3,
      });

      expect(result).toBeDefined();
      expect(result.results).toBeInstanceOf(Array);
      expect(result.totalCount).toBeGreaterThanOrEqual(0);
      expect(result.searchStats).toBeDefined();
      expect(result.searchStats.tradeNotesSearched).toBeGreaterThanOrEqual(0);
      expect(result.searchStats.aiTradeNotesSearched).toBeGreaterThanOrEqual(0);
    });

    it('OHLCVデータからの検索が動作する', async () => {
      const testOHLCV = generateTestOHLCV(100, 20);
      
      const result = await service.searchSimilarNotes({
        ohlcvData: testOHLCV,
        topK: 5,
        minSimilarity: 0.3,
      });

      expect(result).toBeDefined();
      expect(result.results).toBeInstanceOf(Array);
      expect(result.totalCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe('フィルタリング機能', () => {
    it('シンボルフィルタが動作する', async () => {
      const testVector = [0.5, 0.6, 0.7, 0.4, 0.5, 0.6, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
      
      const result = await service.searchSimilarNotes({
        featureVector: testVector,
        symbol: 'EURUSD',
        topK: 10,
      });

      // すべての結果が指定シンボルである
      result.results.forEach(item => {
        expect(item.symbol).toBe('EURUSD');
      });
    });

    it('最小類似度フィルタが動作する', async () => {
      const testVector = [0.5, 0.6, 0.7, 0.4, 0.5, 0.6, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
      const minSimilarity = 0.7;
      
      const result = await service.searchSimilarNotes({
        featureVector: testVector,
        minSimilarity,
        topK: 10,
      });

      // すべての結果が最小類似度以上
      result.results.forEach(item => {
        expect(item.similarity).toBeGreaterThanOrEqual(minSimilarity);
      });
    });
  });

  describe('検索対象制御', () => {
    it('TradeNoteのみ検索できる', async () => {
      const testVector = [0.5, 0.6, 0.7, 0.4, 0.5, 0.6, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
      
      const result = await service.searchSimilarNotes({
        featureVector: testVector,
        searchTradeNotes: true,
        searchAITradeNotes: false,
        topK: 10,
      });

      // すべての結果が TradeNote
      result.results.forEach(item => {
        expect(item.noteType).toBe('tradeNote');
      });
      
      // AITradeNote は検索されていない
      expect(result.searchStats.aiTradeNotesSearched).toBe(0);
    });

    it('AITradeNoteのみ検索できる', async () => {
      const testVector = [0.5, 0.6, 0.7, 0.4, 0.5, 0.6, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
      
      const result = await service.searchSimilarNotes({
        featureVector: testVector,
        searchTradeNotes: false,
        searchAITradeNotes: true,
        topK: 10,
      });

      // すべての結果が AITradeNote
      result.results.forEach(item => {
        expect(item.noteType).toBe('aiTradeNote');
      });
      
      // TradeNote は検索されていない
      expect(result.searchStats.tradeNotesSearched).toBe(0);
    });
  });

  describe('結果マージとソート', () => {
    it('結果が類似度降順でソートされる', async () => {
      const testVector = [0.5, 0.6, 0.7, 0.4, 0.5, 0.6, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
      
      const result = await service.searchSimilarNotes({
        featureVector: testVector,
        topK: 10,
        minSimilarity: 0.3,
      });

      // 類似度降順チェック
      for (let i = 1; i < result.results.length; i++) {
        expect(result.results[i - 1].similarity).toBeGreaterThanOrEqual(
          result.results[i].similarity
        );
      }
    });

    it('topK制限が適用される', async () => {
      const testVector = [0.5, 0.6, 0.7, 0.4, 0.5, 0.6, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
      const topK = 3;
      
      const result = await service.searchSimilarNotes({
        featureVector: testVector,
        topK,
        minSimilarity: 0.0, // 低めに設定して多く拾う
      });

      // 結果数がtopK以下
      expect(result.results.length).toBeLessThanOrEqual(topK);
    });
  });

  describe('統計情報', () => {
    it('検索統計が正しく集計される', async () => {
      const testVector = [0.5, 0.6, 0.7, 0.4, 0.5, 0.6, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
      
      const result = await service.searchSimilarNotes({
        featureVector: testVector,
        topK: 10,
        minSimilarity: 0.5,
      });

      const stats = result.searchStats;
      
      // 統計値が非負
      expect(stats.tradeNotesSearched).toBeGreaterThanOrEqual(0);
      expect(stats.aiTradeNotesSearched).toBeGreaterThanOrEqual(0);
      expect(stats.tradeNotesMatched).toBeGreaterThanOrEqual(0);
      expect(stats.aiTradeNotesMatched).toBeGreaterThanOrEqual(0);
      
      // マッチ数は検索数以下
      expect(stats.tradeNotesMatched).toBeLessThanOrEqual(stats.tradeNotesSearched);
      expect(stats.aiTradeNotesMatched).toBeLessThanOrEqual(stats.aiTradeNotesSearched);
    });
  });

  describe('エラーハンドリング', () => {
    it('OHLCVデータと特徴ベクトルが両方ないとエラー', async () => {
      await expect(
        service.searchSimilarNotes({
          topK: 10,
        })
      ).rejects.toThrow();
    });
  });

  describe('結果の構造検証', () => {
    it('結果アイテムが必須フィールドを含む', async () => {
      const testVector = [0.5, 0.6, 0.7, 0.4, 0.5, 0.6, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
      
      const result = await service.searchSimilarNotes({
        featureVector: testVector,
        topK: 5,
        minSimilarity: 0.3,
      });

      if (result.results.length > 0) {
        const item = result.results[0];
        
        // 必須フィールドのチェック
        expect(item.noteId).toBeDefined();
        expect(item.noteType).toMatch(/^(tradeNote|aiTradeNote)$/);
        expect(item.similarity).toBeGreaterThanOrEqual(0);
        expect(item.similarity).toBeLessThanOrEqual(1);
        expect(item.distance).toBeGreaterThanOrEqual(0);
        expect(item.symbol).toBeDefined();
        expect(item.date).toBeDefined();
      }
    });
  });
});
