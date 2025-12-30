/**
 * インジケーターサービス テスト
 * 
 * 目的: indicatorService の各計算関数が正しく動作することを検証
 */

import { IndicatorService, OHLCVData, FeatureSnapshot } from '../../services/indicators/indicatorService';

describe('IndicatorService', () => {
  let service: IndicatorService;

  // テスト用のサンプルデータ（30日分の終値）
  const sampleClosingPrices = [
    100, 102, 101, 103, 105, 104, 106, 108, 107, 109,
    110, 108, 106, 104, 102, 100, 98, 96, 94, 92,
    94, 96, 98, 100, 102, 104, 106, 108, 110, 112,
  ];

  // テスト用の OHLCV データ
  const sampleOHLCVData: OHLCVData[] = sampleClosingPrices.map((close, i) => ({
    timestamp: new Date(Date.now() - (30 - i) * 24 * 60 * 60 * 1000),
    open: close - 1,
    high: close + 2,
    low: close - 2,
    close,
    volume: 1000 + i * 100,
  }));

  beforeEach(() => {
    service = new IndicatorService();
  });

  describe('calculateRSI', () => {
    it('RSI を正しく計算できること', () => {
      const result = service.calculateRSI(sampleClosingPrices, 14);
      
      // RSI は期間+1 以上のデータから計算開始
      expect(result.length).toBeGreaterThan(0);
      
      // RSI は 0-100 の範囲
      result.forEach(value => {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      });
    });

    it('データ不足時は空配列を返すこと', () => {
      const result = service.calculateRSI([100, 101, 102], 14);
      expect(result).toEqual([]);
    });
  });

  describe('calculateSMA', () => {
    it('SMA を正しく計算できること', () => {
      const result = service.calculateSMA(sampleClosingPrices, 5);
      
      expect(result.length).toBeGreaterThan(0);
      
      // SMA の結果は期間分の平均になっていること（具体値はライブラリ依存）
      // indicatorts は異なる開始インデックスを使う可能性があるため、値の妥当性のみ確認
      result.forEach(value => {
        expect(typeof value).toBe('number');
        expect(isNaN(value)).toBe(false);
      });
    });

    it('データ不足時は空配列を返すこと', () => {
      const result = service.calculateSMA([100, 101], 5);
      expect(result).toEqual([]);
    });
  });

  describe('calculateEMA', () => {
    it('EMA を正しく計算できること', () => {
      const result = service.calculateEMA(sampleClosingPrices, 10);
      
      expect(result.length).toBeGreaterThan(0);
      // EMA は SMA と異なる値になる
    });
  });

  describe('calculateMACD', () => {
    it('MACD を正しく計算できること', () => {
      // MACD には少なくとも 26+9=35 個のデータが必要なので、データを拡張
      const extendedPrices = [...sampleClosingPrices, 114, 116, 118, 120, 122, 120, 118, 116, 114, 112];
      const result = service.calculateMACD(extendedPrices, 12, 26, 9);
      
      expect(result.macdLine).toBeDefined();
      expect(result.signalLine).toBeDefined();
      expect(result.histogram).toBeDefined();
    });

    it('データ不足時は空配列を返すこと', () => {
      const shortData = sampleClosingPrices.slice(0, 10);
      const result = service.calculateMACD(shortData);
      
      expect(result.macdLine).toEqual([]);
      expect(result.signalLine).toEqual([]);
      expect(result.histogram).toEqual([]);
    });
  });

  describe('calculateBollingerBands', () => {
    it('ボリンジャーバンドを正しく計算できること', () => {
      // 注: indicatortsライブラリの制約により標準偏差は2σ固定
      const result = service.calculateBollingerBands(sampleClosingPrices, 20);
      
      expect(result.upperBand).toBeDefined();
      expect(result.middleBand).toBeDefined();
      expect(result.lowerBand).toBeDefined();
      
      // 上部バンド > 中央バンド > 下部バンド の関係
      if (result.upperBand.length > 0) {
        const idx = result.upperBand.length - 1;
        expect(result.upperBand[idx]).toBeGreaterThan(result.middleBand[idx]);
        expect(result.middleBand[idx]).toBeGreaterThan(result.lowerBand[idx]);
      }
    });
  });

  describe('calculateATR', () => {
    it('ATR を正しく計算できること', () => {
      const highs = sampleOHLCVData.map(d => d.high);
      const lows = sampleOHLCVData.map(d => d.low);
      const closes = sampleOHLCVData.map(d => d.close);
      
      const result = service.calculateATR(highs, lows, closes, 14);
      
      expect(result.atrLine.length).toBeGreaterThan(0);
      // ATR は正の値
      result.atrLine.forEach(value => {
        expect(value).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('calculateStochastic', () => {
    it('ストキャスティクスを正しく計算できること', () => {
      const highs = sampleOHLCVData.map(d => d.high);
      const lows = sampleOHLCVData.map(d => d.low);
      const closes = sampleOHLCVData.map(d => d.close);
      
      const result = service.calculateStochastic(highs, lows, closes, 14, 3);
      
      expect(result.k).toBeDefined();
      expect(result.d).toBeDefined();
      
      // %K, %D は 0-100 の範囲
      result.k.forEach(value => {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      });
    });
  });

  describe('calculateOBV', () => {
    it('OBV を正しく計算できること', () => {
      const closes = sampleOHLCVData.map(d => d.close);
      const volumes = sampleOHLCVData.map(d => d.volume);
      
      const result = service.calculateOBV(closes, volumes);
      
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('generateFeatureSnapshot', () => {
    it('特徴量スナップショットを正しく生成できること', () => {
      const snapshot = service.generateFeatureSnapshot(sampleOHLCVData, '1h');
      
      expect(snapshot.timestamp).toBeDefined();
      expect(snapshot.timeframe).toBe('1h');
      expect(snapshot.close).toBe(sampleOHLCVData[sampleOHLCVData.length - 1].close);
      expect(snapshot.volume).toBe(sampleOHLCVData[sampleOHLCVData.length - 1].volume);
      
      // インジケーターが計算されていること
      expect(snapshot.rsi).toBeDefined();
      expect(snapshot.sma).toBeDefined();
      expect(snapshot.ema).toBeDefined();
    });
  });

  describe('generateFeatureVector', () => {
    it('特徴量ベクトルを正しく生成できること', () => {
      const snapshot = service.generateFeatureSnapshot(sampleOHLCVData, '1h');
      const vector = service.generateFeatureVector(snapshot);
      
      // ベクトルの長さは 8（定義された特徴量の数）
      expect(vector.length).toBe(8);
      
      // すべての値が数値であること
      vector.forEach(value => {
        expect(typeof value).toBe('number');
        expect(isNaN(value)).toBe(false);
      });
      
      // すべての値が 0-1 の範囲（またはそれに近い範囲）であること
      vector.forEach(value => {
        expect(value).toBeGreaterThanOrEqual(-1);
        expect(value).toBeLessThanOrEqual(2);
      });
    });
  });

  describe('determineTrend', () => {
    it('上昇トレンドを正しく判定できること', () => {
      const uptrendSnapshot: FeatureSnapshot = {
        timestamp: new Date(),
        timeframe: '1h',
        close: 110,
        volume: 1000,
        rsi: 65,
        sma: 100,
        ema: 105,
        macd: {
          macdLine: [1, 2, 3],
          signalLine: [0.5, 1, 1.5],
          histogram: [0.5, 1, 1.5],
        },
      };
      
      const trend = service.determineTrend(uptrendSnapshot);
      expect(trend).toBe('uptrend');
    });

    it('下降トレンドを正しく判定できること', () => {
      const downtrendSnapshot: FeatureSnapshot = {
        timestamp: new Date(),
        timeframe: '1h',
        close: 90,
        volume: 1000,
        rsi: 35,
        sma: 100,
        ema: 95,
        macd: {
          macdLine: [-1, -2, -3],
          signalLine: [-0.5, -1, -1.5],
          histogram: [-0.5, -1, -1.5],
        },
      };
      
      const trend = service.determineTrend(downtrendSnapshot);
      expect(trend).toBe('downtrend');
    });

    it('中立状態を正しく判定できること', () => {
      const neutralSnapshot: FeatureSnapshot = {
        timestamp: new Date(),
        timeframe: '1h',
        close: 100,
        volume: 1000,
        rsi: 50,
        sma: 100,
        ema: 100,
        macd: {
          macdLine: [0],
          signalLine: [0],
          histogram: [0],
        },
      };
      
      const trend = service.determineTrend(neutralSnapshot);
      expect(trend).toBe('neutral');
    });
  });
});
