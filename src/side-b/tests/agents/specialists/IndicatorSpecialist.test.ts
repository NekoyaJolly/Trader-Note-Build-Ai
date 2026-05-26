/**
 * IndicatorSpecialist 単体テスト (Phase 6.8、2026-05-27)
 *
 * 設計書: docs/architecture/INDICATOR_SPECIALIST_DESIGN.md
 *
 * 検証範囲 (本 PR = 基盤実装):
 * - toIndicatorSeries の変換ロジック (= analysis-engine 生レスポンス → IndicatorSeries)
 * - buildMacros の flat 展開 (= ドット記法を使わない placeholder マップ)
 * - hasMinimumDataForAnalysis の P0 必須判定
 * - IndicatorAnalysisSchema (Zod) の検証
 *
 * 接続切替テスト (= aiOrchestrator 経路 / HypothesisGenerator 受け取り) は次 PR で追加。
 */

import {
  toIndicatorSeries,
  buildMacros,
  IndicatorSpecialist,
} from '../../../agents/specialists/IndicatorSpecialist';
import {
  IndicatorAnalysisSchema,
  type IndicatorSpecialistInput,
  type TimeframeData,
  type IndicatorSeries,
} from '../../../agents/specialists/types';

function makeSeries(values: Array<number | null>): IndicatorSeries {
  return toIndicatorSeries(values);
}

function makeTimeframeData(overrides?: Partial<TimeframeData>): TimeframeData {
  return {
    indicators: {
      sma: makeSeries([1.0, 1.1, 1.2]),
      ema: makeSeries([1.0, 1.05, 1.1]),
      rsi: makeSeries([50, 55, 60]),
      macd: makeSeries([0.001, 0.002, 0.003]),
      atr: makeSeries([0.01, 0.011, 0.012]),
    },
    priceContext: {
      latestClose: 1.5,
      latestVolume: 1000,
      sessionHigh: 1.52,
      sessionLow: 1.48,
    },
    ...overrides,
  };
}

function makeInput(overrides?: Partial<IndicatorSpecialistInput>): IndicatorSpecialistInput {
  return {
    symbol: 'NZDCHF',
    currentTimeframe: '15m',
    higherTimeframe: '1h',
    current: makeTimeframeData(),
    higher: makeTimeframeData(),
    ...overrides,
  };
}

describe('IndicatorSpecialist', () => {
  describe('toIndicatorSeries', () => {
    it('空配列なら latest/previous=null + recentValues=[]', () => {
      const s = toIndicatorSeries([]);
      expect(s.latest).toBeNull();
      expect(s.previous).toBeNull();
      expect(s.recentValues).toEqual([]);
      expect(s.summary).toBeUndefined();
    });

    it('単一要素なら latest 設定 / previous=null', () => {
      const s = toIndicatorSeries([42]);
      expect(s.latest).toBe(42);
      expect(s.previous).toBeNull();
      expect(s.recentValues).toEqual([42]);
      expect(s.summary).toBeDefined();
      expect(s.summary?.mean).toBe(42);
    });

    it('複数要素で latest/previous + recentValues + summary を計算', () => {
      const s = toIndicatorSeries([1, 2, 3, 4, 5]);
      expect(s.latest).toBe(5);
      expect(s.previous).toBe(4);
      expect(s.recentValues).toEqual([1, 2, 3, 4, 5]);
      expect(s.summary?.mean).toBe(3);
      expect(s.summary?.min).toBe(1);
      expect(s.summary?.max).toBe(5);
    });

    it('null 値は recentValues に保持しつつ summary 計算からは除外', () => {
      const s = toIndicatorSeries([null, 10, null, 20, 30]);
      expect(s.latest).toBe(30);
      expect(s.previous).toBe(20);
      expect(s.summary?.mean).toBe(20); // (10+20+30)/3
      expect(s.summary?.min).toBe(10);
      expect(s.summary?.max).toBe(30);
    });

    it('recentN を指定すると末尾 N 件だけ recentValues に', () => {
      const s = toIndicatorSeries([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3);
      expect(s.recentValues).toEqual([8, 9, 10]);
      expect(s.latest).toBe(10);
    });
  });

  describe('buildMacros', () => {
    it('flat キー (= currentRsi, higherRsi 等) で展開、ドット記法を使わない', () => {
      const input = makeInput();
      const macros = buildMacros(input);

      // 基本 placeholder
      expect(macros.symbol).toBe('NZDCHF');
      expect(macros.currentTimeframe).toBe('15m');
      expect(macros.higherTimeframe).toBe('1h');
      expect(macros.latestClose).toBe('1.50000');

      // indicator は currentXxx / higherXxx の flat キー
      expect(macros.currentRsi).toContain('latest=');
      expect(macros.higherRsi).toContain('latest=');

      // ドット記法のキーは生成されない
      expect(macros['current.indicators.rsi']).toBeUndefined();
    });

    it('indicator カタログを indicatorCatalog キーで含む', () => {
      const macros = buildMacros(makeInput());
      expect(typeof macros.indicatorCatalog).toBe('string');
      expect(macros.indicatorCatalog).toContain('RSI');
      expect(macros.indicatorCatalog).toContain('MACD');
    });

    it('不在 indicator は (unavailable) で表示', () => {
      const input = makeInput({
        current: makeTimeframeData({
          indicators: {
            // sma だけ、他は欠落
            sma: makeSeries([1, 2, 3]),
          },
        }),
      });
      const macros = buildMacros(input);
      expect(macros.currentSma).toContain('latest=');
      expect(macros.currentRsi).toBe('(unavailable)');
      expect(macros.currentMacd).toBe('(unavailable)');
    });
  });

  describe('hasMinimumDataForAnalysis', () => {
    it('P0 必須 (sma/ema/rsi/macd/atr) が全部揃えば true', () => {
      const input = makeInput();
      expect(IndicatorSpecialist.hasMinimumDataForAnalysis(input)).toBe(true);
    });

    it('P0 のいずれかが欠落すれば false', () => {
      const input = makeInput({
        current: makeTimeframeData({
          indicators: {
            sma: makeSeries([1, 2]),
            ema: makeSeries([1, 2]),
            // rsi 欠落
            macd: makeSeries([1, 2]),
            atr: makeSeries([1, 2]),
          },
        }),
      });
      expect(IndicatorSpecialist.hasMinimumDataForAnalysis(input)).toBe(false);
    });
  });

  describe('IndicatorAnalysisSchema', () => {
    const validOutput = {
      interpretation: '現 TF は RSI 62 で短期上昇、上位 TF も aligned bullish',
      confidence: 0.7,
      current: {
        trendState: 'weak_up' as const,
        trendStrength: 0.6,
        trendMaturity: 'middle' as const,
        keyLevels: { support: [1.4], resistance: [1.55] },
        momentum: 'bullish' as const,
        divergence: 'none' as const,
        volatilityRegime: 'normal' as const,
        breakoutRisk: 'medium' as const,
        volumeSignal: 'normal' as const,
      },
      higher: {
        trendState: 'weak_up' as const,
        trendStrength: 0.5,
        keyLevels: { support: [1.35], resistance: [1.6] },
        momentum: 'bullish' as const,
      },
      mtfAlignment: {
        trendAlignment: 'aligned_bullish' as const,
        pullbackOpportunity: false,
        counterTrendSignal: false,
      },
      primaryIndicators: {
        current: ['rsi', 'macd'],
        higher: ['ichimoku'],
      },
    };

    it('valid な IndicatorAnalysis は parse 成功', () => {
      const result = IndicatorAnalysisSchema.safeParse(validOutput);
      expect(result.success).toBe(true);
    });

    it('未知 trendState は reject', () => {
      const invalid = {
        ...validOutput,
        current: { ...validOutput.current, trendState: 'unknown' },
      };
      const result = IndicatorAnalysisSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('confidence の範囲 (0-1) を強制', () => {
      const invalid = { ...validOutput, confidence: 1.5 };
      const result = IndicatorAnalysisSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('未知 trendAlignment は reject', () => {
      const invalid = {
        ...validOutput,
        mtfAlignment: { ...validOutput.mtfAlignment, trendAlignment: 'random' },
      };
      const result = IndicatorAnalysisSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('primaryIndicators 欠落は reject', () => {
      const { primaryIndicators: _, ...rest } = validOutput;
      const result = IndicatorAnalysisSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });
  });
});
