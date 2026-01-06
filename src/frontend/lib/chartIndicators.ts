/**
 * チャート用インジケーター計算ユーティリティ
 * 
 * OHLCVデータから各種インジケーターを計算し、
 * CandlestickChart に渡せる形式に変換する
 */

import { OHLCVDataPoint, IndicatorLineConfig } from '../components/CandlestickChart';

// ========================================
// インジケーター計算結果型
// ========================================

interface IndicatorDataPoint {
  timestamp: number;
  value: number;
}

interface BollingerBandsResult {
  upper: IndicatorDataPoint[];
  middle: IndicatorDataPoint[];
  lower: IndicatorDataPoint[];
}

interface MACDResult {
  macd: IndicatorDataPoint[];
  signal: IndicatorDataPoint[];
  histogram: IndicatorDataPoint[];
}

interface IchimokuResult {
  tenkan: IndicatorDataPoint[];
  kijun: IndicatorDataPoint[];
  senkouA: IndicatorDataPoint[];
  senkouB: IndicatorDataPoint[];
  chikou: IndicatorDataPoint[];
}

// ========================================
// 基本計算ヘルパー
// ========================================

/**
 * 単純移動平均 (SMA)
 */
export function calculateSMA(
  data: OHLCVDataPoint[],
  period: number
): IndicatorDataPoint[] {
  const result: IndicatorDataPoint[] = [];
  
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += data[i - j].close;
    }
    result.push({
      timestamp: data[i].timestamp,
      value: sum / period,
    });
  }
  
  return result;
}

/**
 * 指数移動平均 (EMA)
 */
export function calculateEMA(
  data: OHLCVDataPoint[],
  period: number
): IndicatorDataPoint[] {
  const result: IndicatorDataPoint[] = [];
  const multiplier = 2 / (period + 1);
  
  // 最初の値はSMA
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += data[i].close;
  }
  let ema = sum / period;
  result.push({
    timestamp: data[period - 1].timestamp,
    value: ema,
  });
  
  // EMA計算
  for (let i = period; i < data.length; i++) {
    ema = (data[i].close - ema) * multiplier + ema;
    result.push({
      timestamp: data[i].timestamp,
      value: ema,
    });
  }
  
  return result;
}

/**
 * RSI (Relative Strength Index)
 */
export function calculateRSI(
  data: OHLCVDataPoint[],
  period: number = 14
): IndicatorDataPoint[] {
  const result: IndicatorDataPoint[] = [];
  const gains: number[] = [];
  const losses: number[] = [];
  
  // 価格変動を計算
  for (let i = 1; i < data.length; i++) {
    const change = data[i].close - data[i - 1].close;
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? -change : 0);
  }
  
  // 最初の平均
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
  
  // RSI計算
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));
    
    result.push({
      timestamp: data[i + 1].timestamp, // gains/lossesは1つずれている
      value: rsi,
    });
  }
  
  return result;
}

/**
 * MACD
 */
export function calculateMACD(
  data: OHLCVDataPoint[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): MACDResult {
  const fastEMA = calculateEMA(data, fastPeriod);
  const slowEMA = calculateEMA(data, slowPeriod);
  
  // MACD Line = Fast EMA - Slow EMA
  const macdLine: IndicatorDataPoint[] = [];
  const slowStartIndex = slowPeriod - fastPeriod;
  
  for (let i = 0; i < slowEMA.length; i++) {
    const fastIndex = i + slowStartIndex;
    if (fastIndex < fastEMA.length) {
      macdLine.push({
        timestamp: slowEMA[i].timestamp,
        value: fastEMA[fastIndex].value - slowEMA[i].value,
      });
    }
  }
  
  // Signal Line = MACD LineのEMA
  const signalLine: IndicatorDataPoint[] = [];
  const signalMultiplier = 2 / (signalPeriod + 1);
  
  if (macdLine.length >= signalPeriod) {
    let signalSum = 0;
    for (let i = 0; i < signalPeriod; i++) {
      signalSum += macdLine[i].value;
    }
    let signal = signalSum / signalPeriod;
    signalLine.push({
      timestamp: macdLine[signalPeriod - 1].timestamp,
      value: signal,
    });
    
    for (let i = signalPeriod; i < macdLine.length; i++) {
      signal = (macdLine[i].value - signal) * signalMultiplier + signal;
      signalLine.push({
        timestamp: macdLine[i].timestamp,
        value: signal,
      });
    }
  }
  
  // Histogram = MACD Line - Signal Line
  const histogram: IndicatorDataPoint[] = [];
  const signalStartIndex = signalPeriod - 1;
  
  for (let i = 0; i < signalLine.length; i++) {
    const macdIndex = i + signalStartIndex;
    histogram.push({
      timestamp: signalLine[i].timestamp,
      value: macdLine[macdIndex].value - signalLine[i].value,
    });
  }
  
  return { macd: macdLine, signal: signalLine, histogram };
}

/**
 * ボリンジャーバンド
 */
export function calculateBollingerBands(
  data: OHLCVDataPoint[],
  period: number = 20,
  stdDev: number = 2
): BollingerBandsResult {
  const middle = calculateSMA(data, period);
  const upper: IndicatorDataPoint[] = [];
  const lower: IndicatorDataPoint[] = [];
  
  for (let i = period - 1; i < data.length; i++) {
    // 標準偏差計算
    const slice = data.slice(i - period + 1, i + 1);
    const mean = middle[i - period + 1].value;
    const variance = slice.reduce((sum, d) => sum + Math.pow(d.close - mean, 2), 0) / period;
    const std = Math.sqrt(variance);
    
    upper.push({
      timestamp: data[i].timestamp,
      value: mean + std * stdDev,
    });
    lower.push({
      timestamp: data[i].timestamp,
      value: mean - std * stdDev,
    });
  }
  
  return { upper, middle, lower };
}

/**
 * ATR (Average True Range)
 */
export function calculateATR(
  data: OHLCVDataPoint[],
  period: number = 14
): IndicatorDataPoint[] {
  const result: IndicatorDataPoint[] = [];
  const tr: number[] = [];
  
  // True Range計算
  for (let i = 1; i < data.length; i++) {
    const high = data[i].high;
    const low = data[i].low;
    const prevClose = data[i - 1].close;
    
    tr.push(Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    ));
  }
  
  // ATR計算（Wilder's Smoothing）
  let atr = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result.push({
    timestamp: data[period].timestamp,
    value: atr,
  });
  
  for (let i = period; i < tr.length; i++) {
    atr = (atr * (period - 1) + tr[i]) / period;
    result.push({
      timestamp: data[i + 1].timestamp,
      value: atr,
    });
  }
  
  return result;
}

// ========================================
// チャート用変換ヘルパー
// ========================================

/** インジケーターカラー定義 */
const INDICATOR_COLORS = {
  sma: '#f59e0b',      // amber
  ema: '#3b82f6',      // blue
  rsi: '#8b5cf6',      // violet
  macd: '#ec4899',     // pink
  macdSignal: '#a855f7', // purple
  macdHistogram: '#22c55e', // green
  bbUpper: '#6366f1',  // indigo
  bbMiddle: '#8b5cf6', // violet
  bbLower: '#6366f1',  // indigo
  atr: '#f97316',      // orange
};

/**
 * SMAをチャート用設定に変換
 */
export function smaToChartConfig(
  data: OHLCVDataPoint[],
  period: number,
  id?: string
): IndicatorLineConfig {
  return {
    id: id || `sma-${period}`,
    name: `SMA(${period})`,
    data: calculateSMA(data, period),
    color: INDICATOR_COLORS.sma,
    pane: 'main',
  };
}

/**
 * EMAをチャート用設定に変換
 */
export function emaToChartConfig(
  data: OHLCVDataPoint[],
  period: number,
  id?: string
): IndicatorLineConfig {
  return {
    id: id || `ema-${period}`,
    name: `EMA(${period})`,
    data: calculateEMA(data, period),
    color: INDICATOR_COLORS.ema,
    pane: 'main',
  };
}

/**
 * RSIをチャート用設定に変換
 */
export function rsiToChartConfig(
  data: OHLCVDataPoint[],
  period: number = 14,
  id?: string
): IndicatorLineConfig {
  return {
    id: id || `rsi-${period}`,
    name: `RSI(${period})`,
    data: calculateRSI(data, period),
    color: INDICATOR_COLORS.rsi,
    pane: 'sub',
  };
}

/**
 * MACDをチャート用設定に変換（複数ライン）
 */
export function macdToChartConfigs(
  data: OHLCVDataPoint[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): IndicatorLineConfig[] {
  const macdResult = calculateMACD(data, fastPeriod, slowPeriod, signalPeriod);
  
  return [
    {
      id: 'macd-line',
      name: 'MACD',
      data: macdResult.macd,
      color: INDICATOR_COLORS.macd,
      pane: 'sub',
    },
    {
      id: 'macd-signal',
      name: 'Signal',
      data: macdResult.signal,
      color: INDICATOR_COLORS.macdSignal,
      pane: 'sub',
    },
  ];
}

/**
 * ボリンジャーバンドをチャート用設定に変換（3ライン）
 */
export function bbToChartConfigs(
  data: OHLCVDataPoint[],
  period: number = 20,
  stdDev: number = 2
): IndicatorLineConfig[] {
  const bb = calculateBollingerBands(data, period, stdDev);
  
  return [
    {
      id: 'bb-upper',
      name: 'BB Upper',
      data: bb.upper,
      color: INDICATOR_COLORS.bbUpper,
      lineWidth: 1,
      pane: 'main',
    },
    {
      id: 'bb-middle',
      name: 'BB Middle',
      data: bb.middle,
      color: INDICATOR_COLORS.bbMiddle,
      lineWidth: 1,
      pane: 'main',
    },
    {
      id: 'bb-lower',
      name: 'BB Lower',
      data: bb.lower,
      color: INDICATOR_COLORS.bbLower,
      lineWidth: 1,
      pane: 'main',
    },
  ];
}

/**
 * ATRをチャート用設定に変換
 */
export function atrToChartConfig(
  data: OHLCVDataPoint[],
  period: number = 14,
  id?: string
): IndicatorLineConfig {
  return {
    id: id || `atr-${period}`,
    name: `ATR(${period})`,
    data: calculateATR(data, period),
    color: INDICATOR_COLORS.atr,
    pane: 'sub',
  };
}

// ========================================
// 統合ヘルパー
// ========================================

/** インジケーター設定 */
export interface ChartIndicatorSetting {
  type: 'sma' | 'ema' | 'rsi' | 'macd' | 'bb' | 'atr';
  params?: {
    period?: number;
    fastPeriod?: number;
    slowPeriod?: number;
    signalPeriod?: number;
    stdDev?: number;
  };
}

/**
 * 複数のインジケーター設定からチャート用設定を一括生成
 */
export function generateChartIndicators(
  data: OHLCVDataPoint[],
  settings: ChartIndicatorSetting[]
): IndicatorLineConfig[] {
  const configs: IndicatorLineConfig[] = [];
  
  settings.forEach((setting, index) => {
    const params = setting.params || {};
    
    switch (setting.type) {
      case 'sma':
        configs.push(smaToChartConfig(data, params.period || 20, `sma-${index}`));
        break;
      case 'ema':
        configs.push(emaToChartConfig(data, params.period || 20, `ema-${index}`));
        break;
      case 'rsi':
        configs.push(rsiToChartConfig(data, params.period || 14, `rsi-${index}`));
        break;
      case 'macd':
        configs.push(...macdToChartConfigs(
          data,
          params.fastPeriod || 12,
          params.slowPeriod || 26,
          params.signalPeriod || 9
        ));
        break;
      case 'bb':
        configs.push(...bbToChartConfigs(data, params.period || 20, params.stdDev || 2));
        break;
      case 'atr':
        configs.push(atrToChartConfig(data, params.period || 14, `atr-${index}`));
        break;
    }
  });
  
  return configs;
}
