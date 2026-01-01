/**
 * featureVectorService ユニットテスト
 * 
 * 目的:
 * - 12次元ベクトル生成の正確性を検証
 * - コサイン類似度計算の正確性を検証
 * - 旧フォーマット変換の動作確認
 */

import {
  generateFeatureVector,
  generateFeatureVectorFromIndicators,
  calculateCosineSimilarity,
  calculateSimilarityWithBreakdown,
  getMatchStrength,
  isValid12DVector,
  convertLegacyVector,
  createZeroVector,
  createDefaultVector,
  VECTOR_DIMENSION,
  SIMILARITY_THRESHOLDS,
  type FeatureVector12D,
  type OHLCV,
  type IndicatorData,
  type FeatureGenerationInput,
} from '../../services/featureVectorService';

describe('featureVectorService', () => {
  // ============================================
  // テストデータ
  // ============================================
  
  const sampleOHLCV: OHLCV = {
    timestamp: new Date('2024-01-15T10:00:00Z'),
    open: 100,
    high: 105,
    low: 98,
    close: 103,
    volume: 1000,
  };
  
  const sampleIndicators: IndicatorData = {
    rsi: 65,
    rsiZone: 'neutral',
    macdHistogram: 2.5,
    macdCrossover: 'bullish',
    sma: 101,
    ema: 102,
    smaSlope: 'up',
    emaSlope: 'up',
    priceVsSma: 'above',
    priceVsEma: 'above',
    bbUpper: 110,
    bbMiddle: 100,
    bbLower: 90,
    bbPosition: 0.65,
    bbWidth: 0.02,
    close: 103,
  };
  
  // ============================================
  // generateFeatureVector テスト
  // ============================================
  
  describe('generateFeatureVector', () => {
    it('12次元ベクトルを生成する', () => {
      const input: FeatureGenerationInput = {
        ohlcv: sampleOHLCV,
        indicators: sampleIndicators,
        timestamp: new Date('2024-01-15T10:00:00Z'),
      };
      
      const vector = generateFeatureVector(input);
      
      expect(vector).toHaveLength(VECTOR_DIMENSION);
      expect(isValid12DVector(vector)).toBe(true);
    });
    
    it('すべての次元が数値である', () => {
      const input: FeatureGenerationInput = {
        ohlcv: sampleOHLCV,
        indicators: sampleIndicators,
      };
      
      const vector = generateFeatureVector(input);
      
      vector.forEach((value, index) => {
        expect(typeof value).toBe('number');
        expect(isNaN(value)).toBe(false);
      });
    });
    
    it('RSI 値が正しく正規化される（0-1範囲）', () => {
      const input: FeatureGenerationInput = {
        ohlcv: sampleOHLCV,
        indicators: { rsi: 70 },
      };
      
      const vector = generateFeatureVector(input);
      
      // RSI は [5] に格納
      expect(vector[5]).toBe(0.7);
    });
    
    it('買われすぎゾーン（RSI >= 70）が正しく判定される', () => {
      const input: FeatureGenerationInput = {
        ohlcv: sampleOHLCV,
        indicators: { rsi: 75, rsiZone: 'overbought' },
      };
      
      const vector = generateFeatureVector(input);
      
      // RSI ゾーンは [6] に格納
      expect(vector[6]).toBe(1);
    });
    
    it('売られすぎゾーン（RSI <= 30）が正しく判定される', () => {
      const input: FeatureGenerationInput = {
        ohlcv: sampleOHLCV,
        indicators: { rsi: 25, rsiZone: 'oversold' },
      };
      
      const vector = generateFeatureVector(input);
      
      expect(vector[6]).toBe(0);
    });
    
    it('強気ローソク足が正しく判定される', () => {
      const bullishCandle: OHLCV = {
        timestamp: new Date(),
        open: 100,
        high: 110,
        low: 99,
        close: 108,  // 明確な陽線
        volume: 1000,
      };
      
      const input: FeatureGenerationInput = {
        ohlcv: bullishCandle,
        indicators: {},
      };
      
      const vector = generateFeatureVector(input);
      
      // ローソク足方向は [10] に格納
      expect(vector[10]).toBe(1);  // bullish
    });
    
    it('弱気ローソク足が正しく判定される', () => {
      const bearishCandle: OHLCV = {
        timestamp: new Date(),
        open: 108,
        high: 110,
        low: 99,
        close: 100,  // 明確な陰線
        volume: 1000,
      };
      
      const input: FeatureGenerationInput = {
        ohlcv: bearishCandle,
        indicators: {},
      };
      
      const vector = generateFeatureVector(input);
      
      expect(vector[10]).toBe(0);  // bearish
    });
    
    it('同時線（doji）が正しく判定される', () => {
      const dojiCandle: OHLCV = {
        timestamp: new Date(),
        open: 100,
        high: 110,
        low: 90,
        close: 100.5,  // ほぼ同値
        volume: 1000,
      };
      
      const input: FeatureGenerationInput = {
        ohlcv: dojiCandle,
        indicators: {},
      };
      
      const vector = generateFeatureVector(input);
      
      expect(vector[10]).toBe(0.5);  // doji
    });
  });
  
  // ============================================
  // generateFeatureVectorFromIndicators テスト
  // ============================================
  
  describe('generateFeatureVectorFromIndicators', () => {
    it('OHLCV なしで12次元ベクトルを生成する', () => {
      const vector = generateFeatureVectorFromIndicators(sampleIndicators);
      
      expect(vector).toHaveLength(VECTOR_DIMENSION);
      expect(isValid12DVector(vector)).toBe(true);
    });
    
    it('空のインジケーターでもデフォルト値で生成される', () => {
      const vector = generateFeatureVectorFromIndicators({});
      
      expect(vector).toHaveLength(VECTOR_DIMENSION);
      vector.forEach(v => {
        expect(typeof v).toBe('number');
        expect(isNaN(v)).toBe(false);
      });
    });
  });
  
  // ============================================
  // calculateCosineSimilarity テスト
  // ============================================
  
  describe('calculateCosineSimilarity', () => {
    it('同一ベクトルの類似度は 1 になる', () => {
      const vec = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
      
      const similarity = calculateCosineSimilarity(vec, vec);
      
      expect(similarity).toBeCloseTo(1, 5);
    });
    
    it('直交ベクトルの類似度は 0 になる', () => {
      const vecA = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      const vecB = [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      
      const similarity = calculateCosineSimilarity(vecA, vecB);
      
      expect(similarity).toBe(0);
    });
    
    it('逆方向ベクトルの類似度は -1 に近い', () => {
      const vecA = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
      const vecB = [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1];
      
      const similarity = calculateCosineSimilarity(vecA, vecB);
      
      expect(similarity).toBeCloseTo(-1, 5);
    });
    
    it('次元数が異なる場合は 0 を返す', () => {
      const vecA = [1, 2, 3];
      const vecB = [1, 2, 3, 4, 5];
      
      const similarity = calculateCosineSimilarity(vecA, vecB);
      
      expect(similarity).toBe(0);
    });
    
    it('空ベクトルの場合は 0 を返す', () => {
      const similarity = calculateCosineSimilarity([], []);
      
      expect(similarity).toBe(0);
    });
    
    it('ゼロベクトルの場合は 0 を返す', () => {
      const vecA = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      const vecB = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
      
      const similarity = calculateCosineSimilarity(vecA, vecB);
      
      expect(similarity).toBe(0);
    });
  });
  
  // ============================================
  // calculateSimilarityWithBreakdown テスト
  // ============================================
  
  describe('calculateSimilarityWithBreakdown', () => {
    it('強マッチが正しく判定される（>= 0.90）', () => {
      const vecA = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
      const vecB = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
      
      const result = calculateSimilarityWithBreakdown(vecA, vecB);
      
      expect(result.matchStrength).toBe('strong');
      expect(result.similarity).toBeGreaterThanOrEqual(SIMILARITY_THRESHOLDS.STRONG);
    });
    
    it('次元別寄与度が返される', () => {
      const vecA = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
      const vecB = [0.9, 0.9, 0.9, 0.8, 0.8, 0.7, 0.7, 0.6, 0.6, 0.5, 0.5, 0.5];
      
      const result = calculateSimilarityWithBreakdown(vecA, vecB);
      
      expect(result.breakdown).toBeDefined();
      expect(result.breakdown.trend).toBeDefined();
      expect(result.breakdown.momentum).toBeDefined();
      expect(result.breakdown.overbought).toBeDefined();
      expect(result.breakdown.volatility).toBeDefined();
      expect(result.breakdown.candle).toBeDefined();
      expect(result.breakdown.time).toBeDefined();
    });
  });
  
  // ============================================
  // getMatchStrength テスト
  // ============================================
  
  describe('getMatchStrength', () => {
    it.each([
      [0.95, 'strong'],
      [0.90, 'strong'],
      [0.85, 'medium'],
      [0.80, 'medium'],
      [0.75, 'weak'],
      [0.70, 'weak'],
      [0.65, 'none'],
      [0.50, 'none'],
      [0.00, 'none'],
    ])('類似度 %f は %s と判定される', (similarity, expected) => {
      expect(getMatchStrength(similarity)).toBe(expected);
    });
  });
  
  // ============================================
  // isValid12DVector テスト
  // ============================================
  
  describe('isValid12DVector', () => {
    it('12次元数値配列は有効', () => {
      const vec = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
      expect(isValid12DVector(vec)).toBe(true);
    });
    
    it('11次元配列は無効', () => {
      const vec = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
      expect(isValid12DVector(vec)).toBe(false);
    });
    
    it('13次元配列は無効', () => {
      const vec = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
      expect(isValid12DVector(vec)).toBe(false);
    });
    
    it('NaN を含む配列は無効', () => {
      const vec = [1, 2, NaN, 4, 5, 6, 7, 8, 9, 10, 11, 12];
      expect(isValid12DVector(vec)).toBe(false);
    });
    
    it('文字列を含む配列は無効', () => {
      const vec = [1, 2, 'three', 4, 5, 6, 7, 8, 9, 10, 11, 12] as any;
      expect(isValid12DVector(vec)).toBe(false);
    });
    
    it('null は無効', () => {
      expect(isValid12DVector(null)).toBe(false);
    });
    
    it('undefined は無効', () => {
      expect(isValid12DVector(undefined)).toBe(false);
    });
  });
  
  // ============================================
  // convertLegacyVector テスト
  // ============================================
  
  describe('convertLegacyVector', () => {
    it('7次元ベクトルを12次元に変換する', () => {
      const oldVec = [0.1, 0.5, 0.6, 0.2, 0.7, 0.3, 0.8];  // 7次元
      
      const newVec = convertLegacyVector(oldVec, '7d');
      
      expect(newVec).toHaveLength(VECTOR_DIMENSION);
      expect(isValid12DVector(newVec)).toBe(true);
    });
    
    it('8次元ベクトルを12次元に変換する', () => {
      const oldVec = [0.6, 1.01, 1.02, 0.05, 0.65, 0.7, 0.02, 0.5];  // 8次元
      
      const newVec = convertLegacyVector(oldVec, '8d');
      
      expect(newVec).toHaveLength(VECTOR_DIMENSION);
      expect(isValid12DVector(newVec)).toBe(true);
    });
    
    it('18次元ベクトルを12次元に変換する', () => {
      // 18次元: RSI(3) + MACD(4) + BB(3) + SMA(4) + EMA(4)
      const oldVec = Array(18).fill(0.5);
      
      const newVec = convertLegacyVector(oldVec, '18d');
      
      expect(newVec).toHaveLength(VECTOR_DIMENSION);
      expect(isValid12DVector(newVec)).toBe(true);
    });
  });
  
  // ============================================
  // createZeroVector / createDefaultVector テスト
  // ============================================
  
  describe('createZeroVector', () => {
    it('12次元のゼロベクトルを生成する', () => {
      const vec = createZeroVector();
      
      expect(vec).toHaveLength(VECTOR_DIMENSION);
      vec.forEach(v => expect(v).toBe(0));
    });
  });
  
  describe('createDefaultVector', () => {
    it('12次元のデフォルトベクトルを生成する', () => {
      const vec = createDefaultVector();
      
      expect(vec).toHaveLength(VECTOR_DIMENSION);
      expect(isValid12DVector(vec)).toBe(true);
    });
    
    it('デフォルトベクトルは妥当なニュートラル値を持つ', () => {
      const vec = createDefaultVector();
      
      // トレンド方向は 0（ニュートラル）
      expect(vec[0]).toBe(0);
      // その他はほぼ 0.5
      expect(vec[1]).toBe(0.5);
    });
  });
  
  // ============================================
  // 定数テスト
  // ============================================
  
  describe('定数', () => {
    it('VECTOR_DIMENSION は 12', () => {
      expect(VECTOR_DIMENSION).toBe(12);
    });
    
    it('SIMILARITY_THRESHOLDS が正しく定義されている', () => {
      expect(SIMILARITY_THRESHOLDS.STRONG).toBe(0.90);
      expect(SIMILARITY_THRESHOLDS.MEDIUM).toBe(0.80);
      expect(SIMILARITY_THRESHOLDS.WEAK).toBe(0.70);
    });
  });
  
  // ============================================
  // 統合テスト
  // ============================================
  
  describe('統合テスト', () => {
    it('同一条件から生成されたベクトルは高い類似度を持つ', () => {
      const input1: FeatureGenerationInput = {
        ohlcv: sampleOHLCV,
        indicators: sampleIndicators,
      };
      const input2: FeatureGenerationInput = {
        ohlcv: sampleOHLCV,
        indicators: sampleIndicators,
      };
      
      const vec1 = generateFeatureVector(input1);
      const vec2 = generateFeatureVector(input2);
      
      const similarity = calculateCosineSimilarity(vec1, vec2);
      
      expect(similarity).toBeCloseTo(1, 5);
    });
    
    it('異なる条件から生成されたベクトルは類似度が低い', () => {
      const input1: FeatureGenerationInput = {
        ohlcv: sampleOHLCV,
        indicators: { rsi: 75, rsiZone: 'overbought', macdCrossover: 'bullish' },
      };
      const input2: FeatureGenerationInput = {
        ohlcv: sampleOHLCV,
        indicators: { rsi: 25, rsiZone: 'oversold', macdCrossover: 'bearish' },
      };
      
      const vec1 = generateFeatureVector(input1);
      const vec2 = generateFeatureVector(input2);
      
      const similarity = calculateCosineSimilarity(vec1, vec2);
      
      // 真逆の状態なので類似度は低いはず
      expect(similarity).toBeLessThan(SIMILARITY_THRESHOLDS.MEDIUM);
    });
  });
});
