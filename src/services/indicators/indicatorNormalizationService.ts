/**
 * インジケーター正規化サービス
 * 
 * 目的:
 * - インジケーター値の正規化処理を一元化
 * - bounded（有界）と unbounded（無界）インジケーターの分類に基づく正規化
 * - Side-A（リアルタイム）と Side-B（バックテスト）で共通使用
 * 
 * 正規化方針:
 * - bounded（0-100等の固定範囲）: そのまま 0-1 にスケール
 * - unbounded（価格ベース等）: Z-score 正規化 → tanh で -1〜1 に収束
 * 
 * 参照: docs/realtime_similarity_notification_architecture.md
 */

import { z } from 'zod';

// ========================================
// 型定義（Zod スキーマ）
// ========================================

/**
 * インジケーター種別
 * 
 * - bounded: 固定範囲（RSI: 0-100, ストキャスティクス: 0-100 等）
 * - unbounded: 無限範囲（価格、ATR、MACD ヒストグラム等）
 */
export const IndicatorCategorySchema = z.enum(['bounded', 'unbounded']);
export type IndicatorCategory = z.infer<typeof IndicatorCategorySchema>;

/**
 * インジケーター正規化設定
 */
export const NormalizationConfigSchema = z.object({
  /** インジケーター ID */
  indicatorId: z.string(),
  /** カテゴリ（bounded / unbounded） */
  category: IndicatorCategorySchema,
  /** bounded の場合の範囲 */
  range: z.object({
    min: z.number(),
    max: z.number(),
  }).optional(),
  /** unbounded の場合の Z-score スケールファクター */
  zScoreFactor: z.number().optional(),
  /** 変換関数のタイプ */
  transformType: z.enum(['linear', 'tanh', 'sigmoid']).default('linear'),
});

export type NormalizationConfig = z.infer<typeof NormalizationConfigSchema>;

/**
 * 正規化入力
 */
export const NormalizationInputSchema = z.object({
  /** 現在の値 */
  currentValue: z.number(),
  /** 履歴値（Z-score 計算用） */
  historicalValues: z.array(z.number()).optional(),
  /** インジケーター ID */
  indicatorId: z.string(),
});

export type NormalizationInput = z.infer<typeof NormalizationInputSchema>;

/**
 * 正規化出力
 */
export const NormalizedValueSchema = z.object({
  /** 正規化後の値（-1 〜 1 または 0 〜 1） */
  normalizedValue: z.number(),
  /** 元の値 */
  originalValue: z.number(),
  /** 適用した正規化方法 */
  method: z.enum(['linear_scale', 'z_score_tanh', 'z_score_sigmoid', 'passthrough']),
  /** Z-score（unbounded の場合） */
  zScore: z.number().optional(),
});

export type NormalizedValue = z.infer<typeof NormalizedValueSchema>;

// ========================================
// インジケーター分類定義
// ========================================

/**
 * 各インジケーターの正規化設定
 * 
 * bounded: 固定範囲を持つインジケーター
 * unbounded: 価格ベースや無限範囲のインジケーター
 */
export const INDICATOR_CONFIGS: Record<string, NormalizationConfig> = {
  // === Bounded（有界）インジケーター ===
  rsi: {
    indicatorId: 'rsi',
    category: 'bounded',
    range: { min: 0, max: 100 },
    transformType: 'linear',
  },
  stochastic_k: {
    indicatorId: 'stochastic_k',
    category: 'bounded',
    range: { min: 0, max: 100 },
    transformType: 'linear',
  },
  stochastic_d: {
    indicatorId: 'stochastic_d',
    category: 'bounded',
    range: { min: 0, max: 100 },
    transformType: 'linear',
  },
  williams_r: {
    indicatorId: 'williams_r',
    category: 'bounded',
    range: { min: -100, max: 0 },
    transformType: 'linear',
  },
  mfi: {
    indicatorId: 'mfi',
    category: 'bounded',
    range: { min: 0, max: 100 },
    transformType: 'linear',
  },
  cci: {
    indicatorId: 'cci',
    category: 'bounded',
    range: { min: -200, max: 200 },  // 実際は無限だが、通常この範囲
    transformType: 'tanh',
  },
  bb_position: {
    indicatorId: 'bb_position',
    category: 'bounded',
    range: { min: 0, max: 1 },
    transformType: 'linear',
  },
  aroon_up: {
    indicatorId: 'aroon_up',
    category: 'bounded',
    range: { min: 0, max: 100 },
    transformType: 'linear',
  },
  aroon_down: {
    indicatorId: 'aroon_down',
    category: 'bounded',
    range: { min: 0, max: 100 },
    transformType: 'linear',
  },
  
  // === Unbounded（無界）インジケーター ===
  sma: {
    indicatorId: 'sma',
    category: 'unbounded',
    zScoreFactor: 2,
    transformType: 'tanh',
  },
  ema: {
    indicatorId: 'ema',
    category: 'unbounded',
    zScoreFactor: 2,
    transformType: 'tanh',
  },
  dema: {
    indicatorId: 'dema',
    category: 'unbounded',
    zScoreFactor: 2,
    transformType: 'tanh',
  },
  tema: {
    indicatorId: 'tema',
    category: 'unbounded',
    zScoreFactor: 2,
    transformType: 'tanh',
  },
  macd_line: {
    indicatorId: 'macd_line',
    category: 'unbounded',
    zScoreFactor: 50,
    transformType: 'tanh',
  },
  macd_signal: {
    indicatorId: 'macd_signal',
    category: 'unbounded',
    zScoreFactor: 50,
    transformType: 'tanh',
  },
  macd_histogram: {
    indicatorId: 'macd_histogram',
    category: 'unbounded',
    zScoreFactor: 50,
    transformType: 'tanh',
  },
  atr: {
    indicatorId: 'atr',
    category: 'unbounded',
    zScoreFactor: 2,
    transformType: 'tanh',
  },
  obv: {
    indicatorId: 'obv',
    category: 'unbounded',
    zScoreFactor: 2,
    transformType: 'tanh',
  },
  vwap: {
    indicatorId: 'vwap',
    category: 'unbounded',
    zScoreFactor: 2,
    transformType: 'tanh',
  },
  roc: {
    indicatorId: 'roc',
    category: 'unbounded',
    zScoreFactor: 10,
    transformType: 'tanh',
  },
  cmf: {
    indicatorId: 'cmf',
    category: 'bounded',
    range: { min: -1, max: 1 },
    transformType: 'linear',
  },
  bb_width: {
    indicatorId: 'bb_width',
    category: 'unbounded',
    zScoreFactor: 2,
    transformType: 'tanh',
  },
};

// ========================================
// 正規化関数
// ========================================

/**
 * インジケーター正規化サービス
 * 
 * インジケーター値を統一された範囲に正規化する
 */
export class IndicatorNormalizationService {
  private configs: Record<string, NormalizationConfig>;
  
  constructor(customConfigs?: Record<string, NormalizationConfig>) {
    // デフォルト設定とカスタム設定をマージ
    this.configs = { ...INDICATOR_CONFIGS, ...customConfigs };
  }
  
  /**
   * 単一のインジケーター値を正規化
   * 
   * @param input - 正規化入力
   * @returns 正規化結果
   */
  normalize(input: NormalizationInput): NormalizedValue {
    const { currentValue, historicalValues, indicatorId } = input;
    const config = this.configs[indicatorId];
    
    // 設定がない場合はパススルー
    if (!config) {
      console.warn(`[IndicatorNormalizationService] 未知のインジケーター: ${indicatorId}`);
      return {
        normalizedValue: currentValue,
        originalValue: currentValue,
        method: 'passthrough',
      };
    }
    
    // カテゴリに応じた正規化
    if (config.category === 'bounded') {
      return this.normalizeBounded(currentValue, config);
    } else {
      return this.normalizeUnbounded(currentValue, historicalValues || [], config);
    }
  }
  
  /**
   * 複数のインジケーター値を一括正規化
   * 
   * @param inputs - 正規化入力の配列
   * @returns 正規化結果の配列
   */
  normalizeAll(inputs: NormalizationInput[]): NormalizedValue[] {
    return inputs.map(input => this.normalize(input));
  }
  
  /**
   * OHLCV データを正規化
   * 
   * リアルタイム類似度計算用にOHLCVを正規化する
   * 
   * @param ohlcv - OHLCV データ
   * @returns 正規化されたOHLCV（0-1範囲）
   */
  normalizeOHLCV(ohlcv: { open: number; high: number; low: number; close: number; volume: number }): {
    normOpen: number;
    normHigh: number;
    normLow: number;
    normClose: number;
    normVolume: number;
    bodySize: number;
    upperWickRatio: number;
    lowerWickRatio: number;
  } {
    const { open, high, low, close, volume } = ohlcv;
    const range = high - low;
    
    // 範囲が0の場合（同値線）は中間値を返す
    if (range === 0) {
      return {
        normOpen: 0.5,
        normHigh: 1,
        normLow: 0,
        normClose: 0.5,
        normVolume: volume > 0 ? 1 : 0,
        bodySize: 0,
        upperWickRatio: 0,
        lowerWickRatio: 0,
      };
    }
    
    // OHLCV 正規化（0-1 範囲）
    const normOpen = (open - low) / range;
    const normClose = (close - low) / range;
    
    // ローソク足構造の特徴量
    const body = Math.abs(close - open);
    const bodySize = body / range;
    const upperWick = high - Math.max(open, close);
    const lowerWick = Math.min(open, close) - low;
    const upperWickRatio = upperWick / range;
    const lowerWickRatio = lowerWick / range;
    
    return {
      normOpen,
      normHigh: 1,      // 定義上常に1
      normLow: 0,       // 定義上常に0
      normClose,
      normVolume: 1,    // 単一バーでは1に正規化（履歴比較時は別途計算）
      bodySize,
      upperWickRatio,
      lowerWickRatio,
    };
  }
  
  /**
   * ローリングウィンドウ内のOHLCVを集約して正規化
   * 
   * 60秒ローリングウィンドウ内の Tick データから OHLCV を生成し、正規化する
   * 
   * @param ticks - ローリングウィンドウ内の価格データ
   * @param avgVolume60s - 60秒平均出来高（正規化用）
   * @returns 正規化されたOHLCV
   */
  normalizeRollingWindowOHLCV(
    ticks: Array<{ price: number; volume: number; timestamp: Date }>,
    avgVolume60s: number = 1
  ): {
    normOpen: number;
    normHigh: number;
    normLow: number;
    normClose: number;
    normVolume: number;
  } | null {
    if (ticks.length === 0) {
      return null;
    }
    
    // OHLCV 集約
    const sortedTicks = [...ticks].sort((a, b) => 
      a.timestamp.getTime() - b.timestamp.getTime()
    );
    
    const open = sortedTicks[0].price;
    const close = sortedTicks[sortedTicks.length - 1].price;
    const high = Math.max(...sortedTicks.map(t => t.price));
    const low = Math.min(...sortedTicks.map(t => t.price));
    const volume = sortedTicks.reduce((sum, t) => sum + t.volume, 0);
    
    const range = high - low;
    
    // 範囲が0の場合
    if (range === 0) {
      return {
        normOpen: 0.5,
        normHigh: 1,
        normLow: 0,
        normClose: 0.5,
        normVolume: avgVolume60s > 0 ? volume / avgVolume60s : 0,
      };
    }
    
    return {
      normOpen: (open - low) / range,
      normHigh: 1,
      normLow: 0,
      normClose: (close - low) / range,
      normVolume: avgVolume60s > 0 ? volume / avgVolume60s : 0,
    };
  }
  
  /**
   * 正規化設定を取得
   */
  getConfig(indicatorId: string): NormalizationConfig | undefined {
    return this.configs[indicatorId];
  }
  
  /**
   * インジケーターのカテゴリを取得
   */
  getCategory(indicatorId: string): IndicatorCategory | undefined {
    return this.configs[indicatorId]?.category;
  }
  
  // ========================================
  // 内部メソッド
  // ========================================
  
  /**
   * Bounded インジケーターの正規化
   * 固定範囲を 0-1 にスケール
   */
  private normalizeBounded(value: number, config: NormalizationConfig): NormalizedValue {
    const { range, transformType } = config;
    
    if (!range) {
      // 範囲が未定義の場合はパススルー
      return {
        normalizedValue: value,
        originalValue: value,
        method: 'passthrough',
      };
    }
    
    const { min, max } = range;
    const rangeSize = max - min;
    
    // 0-1 にスケール
    let scaled = (value - min) / rangeSize;
    
    // クランプ
    scaled = Math.max(0, Math.min(1, scaled));
    
    // 変換タイプに応じた処理
    let normalizedValue: number;
    if (transformType === 'tanh') {
      // 0-1 を -1〜1 に変換してから tanh
      normalizedValue = Math.tanh((scaled - 0.5) * 2);
    } else if (transformType === 'sigmoid') {
      normalizedValue = 1 / (1 + Math.exp(-((scaled - 0.5) * 10)));
    } else {
      normalizedValue = scaled;
    }
    
    return {
      normalizedValue,
      originalValue: value,
      method: 'linear_scale',
    };
  }
  
  /**
   * Unbounded インジケーターの正規化
   * Z-score → tanh で -1〜1 に収束
   */
  private normalizeUnbounded(
    value: number,
    historicalValues: number[],
    config: NormalizationConfig
  ): NormalizedValue {
    const { zScoreFactor = 2, transformType } = config;
    
    // 履歴がない場合はスケールファクターで直接正規化
    if (historicalValues.length < 2) {
      const normalizedValue = Math.tanh(value / zScoreFactor);
      return {
        normalizedValue,
        originalValue: value,
        method: 'z_score_tanh',
        zScore: value / zScoreFactor,
      };
    }
    
    // Z-score 計算
    const mean = historicalValues.reduce((sum, v) => sum + v, 0) / historicalValues.length;
    const variance = historicalValues.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / historicalValues.length;
    const stdDev = Math.sqrt(variance);
    
    // 標準偏差が0の場合（すべて同じ値）
    if (stdDev === 0) {
      return {
        normalizedValue: 0,
        originalValue: value,
        method: 'z_score_tanh',
        zScore: 0,
      };
    }
    
    const zScore = (value - mean) / stdDev;
    
    // 変換タイプに応じた正規化
    let normalizedValue: number;
    if (transformType === 'sigmoid') {
      normalizedValue = 1 / (1 + Math.exp(-zScore));
    } else {
      // デフォルトは tanh
      normalizedValue = Math.tanh(zScore);
    }
    
    return {
      normalizedValue,
      originalValue: value,
      method: transformType === 'sigmoid' ? 'z_score_sigmoid' : 'z_score_tanh',
      zScore,
    };
  }
}

// ========================================
// ユーティリティ関数
// ========================================

/**
 * 統計量を計算
 */
export function calculateStatistics(values: number[]): {
  mean: number;
  stdDev: number;
  min: number;
  max: number;
} {
  if (values.length === 0) {
    return { mean: 0, stdDev: 0, min: 0, max: 0 };
  }
  
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  const stdDev = Math.sqrt(variance);
  const min = Math.min(...values);
  const max = Math.max(...values);
  
  return { mean, stdDev, min, max };
}

/**
 * Z-score を計算
 */
export function calculateZScore(value: number, mean: number, stdDev: number): number {
  if (stdDev === 0) return 0;
  return (value - mean) / stdDev;
}

/**
 * サービスのシングルトンインスタンス
 */
export const indicatorNormalizationService = new IndicatorNormalizationService();
