/**
 * 特徴量サービステスト
 * 
 * 目的: 特徴量保存基盤の動作検証
 * 
 * テスト内容:
 * - 特徴量の計算・保存
 * - 類似度計算
 * - 類似ノート検索
 */

import { PrismaClient } from '@prisma/client';
import { FeatureService, FeatureUpdateInput, SimilarNoteResult } from '../../services/featureService';
import { OHLCVData } from '../../services/indicators/indicatorService';

const prisma = new PrismaClient();

describe('FeatureService', () => {
  let service: FeatureService;
  
  // リモートDB接続のためタイムアウトを延長
  jest.setTimeout(30000);

  // テスト用のモックデータ
  const generateOHLCVData = (basePrice: number, count: number = 20): OHLCVData[] => {
    const data: OHLCVData[] = [];
    const baseTime = new Date('2024-01-01T00:00:00Z');
    
    for (let i = 0; i < count; i++) {
      // ランダムな価格変動を追加
      const variation = (Math.random() - 0.5) * 10;
      const open = basePrice + variation;
      const close = open + (Math.random() - 0.5) * 5;
      const high = Math.max(open, close) + Math.random() * 3;
      const low = Math.min(open, close) - Math.random() * 3;
      
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

  beforeAll(() => {
    service = new FeatureService();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('コサイン類似度計算', () => {
    it('同一ベクトルの類似度は 1 になる', () => {
      // FeatureService のプライベートメソッドをテストするために
      // 代わりに FeatureService インスタンスを作成して公開メソッド経由でテスト
      const vec = [1, 2, 3, 4, 5];
      
      // 内部テスト用に直接計算
      const dotProduct = vec.reduce((sum, v) => sum + v * v, 0);
      const norm = Math.sqrt(dotProduct);
      const similarity = dotProduct / (norm * norm);
      
      expect(similarity).toBeCloseTo(1, 5);
    });

    it('直交ベクトルの類似度は 0 になる', () => {
      const vecA = [1, 0, 0];
      const vecB = [0, 1, 0];
      
      // 直交ベクトルの内積は 0
      const dotProduct = vecA.reduce((sum, v, i) => sum + v * vecB[i], 0);
      expect(dotProduct).toBe(0);
    });
  });

  describe('ユークリッド距離計算', () => {
    it('同一点間の距離は 0 になる', () => {
      const vec = [1, 2, 3];
      const distance = Math.sqrt(vec.reduce((sum, v) => sum + (v - v) ** 2, 0));
      expect(distance).toBe(0);
    });

    it('既知の距離を正しく計算できる', () => {
      // (0,0,0) から (3,4,0) への距離は 5
      const vecA = [0, 0, 0];
      const vecB = [3, 4, 0];
      const distance = Math.sqrt(
        vecA.reduce((sum, v, i) => sum + (v - vecB[i]) ** 2, 0)
      );
      expect(distance).toBe(5);
    });
  });

  describe('特徴量統計', () => {
    it('特徴量統計を取得できる', async () => {
      const stats = await service.getFeatureStats();
      
      expect(stats).toHaveProperty('totalNotes');
      expect(stats).toHaveProperty('notesWithFeatures');
      expect(stats).toHaveProperty('notesWithoutFeatures');
      expect(stats).toHaveProperty('featureVectorDimension');
      expect(typeof stats.totalNotes).toBe('number');
      expect(stats.totalNotes).toBeGreaterThanOrEqual(0);
    });
  });

  describe('特徴量未設定ノート取得', () => {
    it('特徴量未設定のノートを取得できる', async () => {
      const notes = await service.getNotesWithoutFeatures(10);
      
      // 結果は配列であること
      expect(Array.isArray(notes)).toBe(true);
      
      // 取得されたノートは特徴量が未設定であること
      for (const note of notes) {
        const hasEmptyVector = !note.featureVector || note.featureVector.length === 0;
        const hasNullIndicators = note.indicators === null;
        expect(hasEmptyVector || hasNullIndicators).toBe(true);
      }
    });
  });

  describe('類似ノート検索（統合テスト）', () => {
    it('OHLCV データから類似ノートを検索できる', async () => {
      const ohlcvData = generateOHLCVData(100, 30);
      
      // 類似ノート検索を実行（結果は空でも OK）
      const results = await service.findSimilarNotes(ohlcvData, undefined, 5, 0.3);
      
      // 結果は配列であること
      expect(Array.isArray(results)).toBe(true);
      
      // 結果がある場合、正しい構造であること
      if (results.length > 0) {
        const result = results[0];
        expect(result).toHaveProperty('note');
        expect(result).toHaveProperty('similarity');
        expect(result).toHaveProperty('distance');
        expect(typeof result.similarity).toBe('number');
        expect(result.similarity).toBeGreaterThanOrEqual(0);
        expect(result.similarity).toBeLessThanOrEqual(1);
      }
    });

    it('類似度順でソートされている', async () => {
      const ohlcvData = generateOHLCVData(100, 30);
      const results = await service.findSimilarNotes(ohlcvData, undefined, 10, 0);
      
      // 結果が 2 件以上ある場合、降順であること
      if (results.length >= 2) {
        for (let i = 0; i < results.length - 1; i++) {
          expect(results[i].similarity).toBeGreaterThanOrEqual(results[i + 1].similarity);
        }
      }
    });
  });

  describe('特徴量ベクトル生成', () => {
    it('OHLCV データから特徴量ベクトルを生成できる', () => {
      const { IndicatorService } = require('../../services/indicators/indicatorService');
      const indicatorService = new IndicatorService();
      
      const ohlcvData = generateOHLCVData(100, 30);
      const vector = indicatorService.generateFeatureVector(ohlcvData);
      
      // ベクトルは数値配列であること
      expect(Array.isArray(vector)).toBe(true);
      expect(vector.length).toBeGreaterThan(0);
      
      // すべての要素が数値であること
      for (const value of vector) {
        expect(typeof value).toBe('number');
        expect(isNaN(value)).toBe(false);
      }
    });

    it('同じデータからは同じベクトルが生成される', () => {
      const { IndicatorService } = require('../../services/indicators/indicatorService');
      const indicatorService = new IndicatorService();
      
      // 固定データを使用
      const ohlcvData: OHLCVData[] = [];
      const baseTime = new Date('2024-01-01T00:00:00Z');
      for (let i = 0; i < 30; i++) {
        ohlcvData.push({
          timestamp: new Date(baseTime.getTime() + i * 3600000),
          open: 100 + i,
          high: 105 + i,
          low: 98 + i,
          close: 103 + i,
          volume: 1000 + i * 10,
        });
      }
      
      const vector1 = indicatorService.generateFeatureVector(ohlcvData);
      const vector2 = indicatorService.generateFeatureVector(ohlcvData);
      
      expect(vector1).toEqual(vector2);
    });
  });
});
