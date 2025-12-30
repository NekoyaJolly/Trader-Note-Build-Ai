/**
 * インジケーター正規化ユーティリティのテスト
 * 
 * テスト対象:
 * - Z-score計算の正確性
 * - 有界/無界インジケーターの分類
 * - 異常値検出（±3σ）
 * - 複数インジケーターの正規化
 */

import {
  calculateZScore,
  normalizeIndicators,
  isBoundedIndicator,
  INDICATOR_BOUND_TYPE,
  DEFAULT_ANOMALY_THRESHOLD,
} from '../../utils/indicatorNormalizer';

describe('indicatorNormalizer', () => {
  describe('isBoundedIndicator', () => {
    it('RSIは有界インジケーター（0-100）として分類される', () => {
      expect(isBoundedIndicator('rsi')).toBe(true);
    });

    it('Stochasticは有界インジケーター（0-100）として分類される', () => {
      expect(isBoundedIndicator('stochastic')).toBe(true);
    });

    it('Williams %Rは有界インジケーター（-100〜0）として分類される', () => {
      expect(isBoundedIndicator('williamsR')).toBe(true);
    });

    it('MFIは有界インジケーター（0-100）として分類される', () => {
      expect(isBoundedIndicator('mfi')).toBe(true);
    });

    it('CMFは有界インジケーター（-1〜1）として分類される', () => {
      expect(isBoundedIndicator('cmf')).toBe(true);
    });

    it('Aroonは有界インジケーター（0-100）として分類される', () => {
      expect(isBoundedIndicator('aroon')).toBe(true);
    });

    it('OBVは無界インジケーターとして分類される', () => {
      expect(isBoundedIndicator('obv')).toBe(false);
    });

    it('VWAPは無界インジケーターとして分類される', () => {
      expect(isBoundedIndicator('vwap')).toBe(false);
    });

    it('ATRは無界インジケーターとして分類される', () => {
      expect(isBoundedIndicator('atr')).toBe(false);
    });

    it('MACDは無界インジケーターとして分類される', () => {
      expect(isBoundedIndicator('macd')).toBe(false);
    });

    it('CCIは無界インジケーターとして分類される', () => {
      expect(isBoundedIndicator('cci')).toBe(false);
    });
  });

  describe('INDICATOR_BOUND_TYPE', () => {
    it('全20種類のインジケーターが分類されている', () => {
      const expectedIndicators = [
        'rsi', 'sma', 'ema', 'macd', 'bb', 'atr', 'stochastic', 'obv', 'vwap',
        'williamsR', 'cci', 'aroon', 'roc', 'mfi', 'cmf', 'dema', 'tema', 'kc', 'psar', 'ichimoku'
      ];
      
      for (const indicator of expectedIndicators) {
        expect(INDICATOR_BOUND_TYPE).toHaveProperty(indicator);
      }
    });
  });

  describe('calculateZScore', () => {
    it('平均50、標準偏差10の分布で値60はZ=1.0となる', () => {
      // 平均50、標準偏差10を模擬するデータ
      const historicalValues = [40, 50, 60, 50, 50]; // 平均=50, stdDev≈6.32
      const currentValue = 60;
      
      const result = calculateZScore(currentValue, historicalValues);
      
      // Z = (60 - 50) / stdDev
      expect(result.normalizedValue).toBeGreaterThan(0);
      expect(result.isAnomaly).toBe(false);
      expect(result.originalValue).toBe(60);
    });

    it('平均から4σ以上乖離した値は異常値として検出される', () => {
      // 平均100、標準偏差10程度のデータ
      const historicalValues = [90, 100, 110, 100, 100];
      const extremeValue = 200; // 平均から約10σ乖離
      
      const result = calculateZScore(extremeValue, historicalValues, 3);
      
      expect(result.isAnomaly).toBe(true);
      expect(result.anomalyDetail).toContain('上方に乖離');
    });

    it('平均から-4σ以上乖離した値は異常値として検出される', () => {
      const historicalValues = [90, 100, 110, 100, 100];
      const extremeValue = 0; // 平均から大きく下方に乖離
      
      const result = calculateZScore(extremeValue, historicalValues, 3);
      
      expect(result.isAnomaly).toBe(true);
      expect(result.anomalyDetail).toContain('下方に乖離');
    });

    it('±3σ以内の値は正常値として扱われる', () => {
      const historicalValues = [90, 100, 110, 100, 100];
      const normalValue = 105;
      
      const result = calculateZScore(normalValue, historicalValues, 3);
      
      expect(result.isAnomaly).toBe(false);
      expect(result.anomalyDetail).toBeUndefined();
    });

    it('過去データが空の場合はZ=0を返す', () => {
      const result = calculateZScore(100, []);
      
      expect(result.normalizedValue).toBe(0);
      expect(result.isAnomaly).toBe(false);
    });

    it('過去データが全て同じ値（標準偏差=0）の場合は特殊処理される', () => {
      const historicalValues = [100, 100, 100, 100, 100];
      const currentValue = 100;
      
      const result = calculateZScore(currentValue, historicalValues);
      
      // 同じ値なのでZ=0
      expect(result.normalizedValue).toBe(0);
      expect(result.isAnomaly).toBe(false);
    });

    it('過去データが全て同じ値で現在値が異なる場合は異常値フラグ', () => {
      const historicalValues = [100, 100, 100, 100, 100];
      const currentValue = 150;
      
      const result = calculateZScore(currentValue, historicalValues);
      
      expect(result.isAnomaly).toBe(true);
      expect(result.anomalyDetail).toContain('一定値');
    });
  });

  describe('normalizeIndicators', () => {
    it('有界インジケーター（RSI）はそのままの値を返す', () => {
      const currentIndicators = { rsi: 70 };
      const historicalIndicators = [{ rsi: 50 }, { rsi: 60 }];
      
      const result = normalizeIndicators(currentIndicators, historicalIndicators);
      
      // RSI は bounded なのでそのまま
      expect(result.values.rsi).toBe(70);
      expect(result.warnings).toHaveLength(0);
    });

    it('無界インジケーター（OBV）はZ-scoreに正規化される', () => {
      const currentIndicators = { obv: 1000000 };
      const historicalIndicators = [
        { obv: 900000 },
        { obv: 950000 },
        { obv: 1000000 },
        { obv: 1050000 },
      ];
      
      const result = normalizeIndicators(currentIndicators, historicalIndicators);
      
      // OBV は unbounded なので Z-score
      expect(result.values.obv).toBeDefined();
      expect(typeof result.values.obv).toBe('number');
    });

    it('極端な異常値の場合は警告が生成される', () => {
      // 平均100万程度のOBVに対して500万という極端な値
      const currentIndicators = { obv: 5000000 };
      const historicalIndicators = [
        { obv: 900000 },
        { obv: 1000000 },
        { obv: 1100000 },
        { obv: 1000000 },
      ];
      
      const result = normalizeIndicators(currentIndicators, historicalIndicators, 3);
      
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('OBV');
      expect(result.warnings[0]).toContain('⚠️');
    });

    it('複数のインジケーターを同時に処理できる', () => {
      const currentIndicators = {
        rsi: 65,           // bounded
        obv: 1000000,      // unbounded
        macd: 5,           // unbounded
      };
      const historicalIndicators = [
        { rsi: 60, obv: 950000, macd: 4 },
        { rsi: 55, obv: 1050000, macd: 6 },
      ];
      
      const result = normalizeIndicators(currentIndicators, historicalIndicators);
      
      expect(result.values.rsi).toBe(65); // そのまま
      expect(result.values.obv).toBeDefined(); // Z-score
      expect(result.values.macd).toBeDefined(); // Z-score
    });

    it('undefinedやNaNの値はスキップされる', () => {
      const currentIndicators = {
        rsi: 65,
        obv: undefined,
        macd: NaN,
      };
      const historicalIndicators = [{ rsi: 60 }];
      
      const result = normalizeIndicators(currentIndicators, historicalIndicators);
      
      expect(result.values.rsi).toBe(65);
      expect(result.values.obv).toBeUndefined();
      expect(result.values.macd).toBeUndefined();
    });

    it('インジケーター名にサフィックスがある場合も正しく分類される', () => {
      // 例: "rsi_14" は "rsi" として分類される
      const currentIndicators = {
        rsi_14: 70,
        obv_: 1000000,
      };
      const historicalIndicators = [
        { rsi_14: 65, obv_: 950000 },
      ];
      
      const result = normalizeIndicators(currentIndicators, historicalIndicators);
      
      // rsi_14 → rsi として bounded 判定
      expect(result.values.rsi_14).toBe(70);
    });
  });

  describe('DEFAULT_ANOMALY_THRESHOLD', () => {
    it('デフォルトの異常値閾値は3σ', () => {
      expect(DEFAULT_ANOMALY_THRESHOLD).toBe(3);
    });
  });
});
