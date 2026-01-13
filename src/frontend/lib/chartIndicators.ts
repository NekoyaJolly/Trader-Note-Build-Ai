/**
 * チャート用インジケーター計算ユーティリティ
 * 
 * OHLCVデータから各種インジケーターを計算し、
 * CandlestickChart に渡せる形式に変換する
 */

import { OHLCVDataPoint, IndicatorLineConfig } from '../components/CandlestickChart';
import { getIndicatorById } from './indicatorDefinitions';

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
// 追加インジケーター計算関数
// ========================================

/**
 * DEMA (Double Exponential Moving Average)
 */
export function calculateDEMA(
  data: OHLCVDataPoint[],
  period: number = 20
): IndicatorDataPoint[] {
  const ema1 = calculateEMA(data, period);
  // EMAのEMAを計算
  const ema1Values = ema1.map(d => d.value);
  const ema2: IndicatorDataPoint[] = [];
  const multiplier = 2 / (period + 1);
  
  if (ema1Values.length < period) return [];
  
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += ema1Values[i];
  }
  let ema2Value = sum / period;
  ema2.push({
    timestamp: ema1[period - 1].timestamp,
    value: ema2Value,
  });
  
  for (let i = period; i < ema1Values.length; i++) {
    ema2Value = (ema1Values[i] - ema2Value) * multiplier + ema2Value;
    ema2.push({
      timestamp: ema1[i].timestamp,
      value: ema2Value,
    });
  }
  
  // DEMA = 2 * EMA1 - EMA2
  const dema: IndicatorDataPoint[] = [];
  for (let i = 0; i < ema2.length; i++) {
    dema.push({
      timestamp: ema2[i].timestamp,
      value: 2 * ema1[i + period - 1].value - ema2[i].value,
    });
  }
  
  return dema;
}

/**
 * TEMA (Triple Exponential Moving Average)
 */
export function calculateTEMA(
  data: OHLCVDataPoint[],
  period: number = 20
): IndicatorDataPoint[] {
  const ema1 = calculateEMA(data, period);
  const ema1Values = ema1.map(d => d.value);
  
  // EMA1のEMA
  const ema2: number[] = [];
  const multiplier = 2 / (period + 1);
  
  if (ema1Values.length < period * 2) return [];
  
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += ema1Values[i];
  }
  let ema2Value = sum / period;
  ema2.push(ema2Value);
  
  for (let i = period; i < ema1Values.length; i++) {
    ema2Value = (ema1Values[i] - ema2Value) * multiplier + ema2Value;
    ema2.push(ema2Value);
  }
  
  // EMA2のEMA
  const ema3: number[] = [];
  sum = 0;
  for (let i = 0; i < period; i++) {
    sum += ema2[i];
  }
  let ema3Value = sum / period;
  ema3.push(ema3Value);
  
  for (let i = period; i < ema2.length; i++) {
    ema3Value = (ema2[i] - ema3Value) * multiplier + ema3Value;
    ema3.push(ema3Value);
  }
  
  // TEMA = 3 * EMA1 - 3 * EMA2 + EMA3
  const tema: IndicatorDataPoint[] = [];
  const startIdx = period * 2 - 2;
  for (let i = 0; i < ema3.length; i++) {
    tema.push({
      timestamp: ema1[startIdx + i].timestamp,
      value: 3 * ema1Values[startIdx + i] - 3 * ema2[i + period - 1] + ema3[i],
    });
  }
  
  return tema;
}

/**
 * Stochastic Oscillator
 */
export function calculateStochastic(
  data: OHLCVDataPoint[],
  kPeriod: number = 14,
  dPeriod: number = 3
): { k: IndicatorDataPoint[]; d: IndicatorDataPoint[] } {
  const k: IndicatorDataPoint[] = [];
  const d: IndicatorDataPoint[] = [];
  
  for (let i = kPeriod - 1; i < data.length; i++) {
    const slice = data.slice(i - kPeriod + 1, i + 1);
    const highest = Math.max(...slice.map(d => d.high));
    const lowest = Math.min(...slice.map(d => d.low));
    const currentClose = data[i].close;
    
    const stochK = highest === lowest ? 50 : ((currentClose - lowest) / (highest - lowest)) * 100;
    k.push({
      timestamp: data[i].timestamp,
      value: stochK,
    });
  }
  
  // %D = %Kの移動平均
  for (let i = dPeriod - 1; i < k.length; i++) {
    const sum = k.slice(i - dPeriod + 1, i + 1).reduce((a, b) => a + b.value, 0);
    d.push({
      timestamp: k[i].timestamp,
      value: sum / dPeriod,
    });
  }
  
  return { k, d };
}

/**
 * Williams %R
 */
export function calculateWilliamsR(
  data: OHLCVDataPoint[],
  period: number = 14
): IndicatorDataPoint[] {
  const result: IndicatorDataPoint[] = [];
  
  for (let i = period - 1; i < data.length; i++) {
    const slice = data.slice(i - period + 1, i + 1);
    const highest = Math.max(...slice.map(d => d.high));
    const lowest = Math.min(...slice.map(d => d.low));
    const currentClose = data[i].close;
    
    const wr = highest === lowest ? -50 : ((highest - currentClose) / (highest - lowest)) * -100;
    result.push({
      timestamp: data[i].timestamp,
      value: wr,
    });
  }
  
  return result;
}

/**
 * CCI (Commodity Channel Index)
 */
export function calculateCCI(
  data: OHLCVDataPoint[],
  period: number = 20
): IndicatorDataPoint[] {
  const result: IndicatorDataPoint[] = [];
  
  for (let i = period - 1; i < data.length; i++) {
    const slice = data.slice(i - period + 1, i + 1);
    const typicalPrices = slice.map(d => (d.high + d.low + d.close) / 3);
    const sma = typicalPrices.reduce((a, b) => a + b, 0) / period;
    
    const meanDeviation = typicalPrices.reduce((sum, tp) => sum + Math.abs(tp - sma), 0) / period;
    const currentTP = (data[i].high + data[i].low + data[i].close) / 3;
    
    const cci = meanDeviation === 0 ? 0 : (currentTP - sma) / (0.015 * meanDeviation);
    result.push({
      timestamp: data[i].timestamp,
      value: cci,
    });
  }
  
  return result;
}

/**
 * ROC (Rate of Change)
 */
export function calculateROC(
  data: OHLCVDataPoint[],
  period: number = 12
): IndicatorDataPoint[] {
  const result: IndicatorDataPoint[] = [];
  
  for (let i = period; i < data.length; i++) {
    const currentClose = data[i].close;
    const pastClose = data[i - period].close;
    const roc = pastClose === 0 ? 0 : ((currentClose - pastClose) / pastClose) * 100;
    result.push({
      timestamp: data[i].timestamp,
      value: roc,
    });
  }
  
  return result;
}

/**
 * Aroon
 */
export function calculateAroon(
  data: OHLCVDataPoint[],
  period: number = 14
): { aroonUp: IndicatorDataPoint[]; aroonDown: IndicatorDataPoint[] } {
  const aroonUp: IndicatorDataPoint[] = [];
  const aroonDown: IndicatorDataPoint[] = [];
  
  for (let i = period - 1; i < data.length; i++) {
    const slice = data.slice(i - period + 1, i + 1);
    let highestIdx = 0;
    let lowestIdx = 0;
    let highest = slice[0].high;
    let lowest = slice[0].low;
    
    for (let j = 1; j < slice.length; j++) {
      if (slice[j].high > highest) {
        highest = slice[j].high;
        highestIdx = j;
      }
      if (slice[j].low < lowest) {
        lowest = slice[j].low;
        lowestIdx = j;
      }
    }
    
    const up = ((period - (period - 1 - highestIdx)) / period) * 100;
    const down = ((period - (period - 1 - lowestIdx)) / period) * 100;
    
    aroonUp.push({
      timestamp: data[i].timestamp,
      value: up,
    });
    aroonDown.push({
      timestamp: data[i].timestamp,
      value: down,
    });
  }
  
  return { aroonUp, aroonDown };
}

/**
 * ADX (Average Directional Index)
 */
export function calculateADX(
  data: OHLCVDataPoint[],
  period: number = 14
): { adx: IndicatorDataPoint[]; plusDI: IndicatorDataPoint[]; minusDI: IndicatorDataPoint[] } {
  const plusDI: IndicatorDataPoint[] = [];
  const minusDI: IndicatorDataPoint[] = [];
  const adx: IndicatorDataPoint[] = [];
  
  // +DM, -DM, TRを計算
  const plusDM: number[] = [];
  const minusDM: number[] = [];
  const tr: number[] = [];
  
  for (let i = 1; i < data.length; i++) {
    const highDiff = data[i].high - data[i - 1].high;
    const lowDiff = data[i - 1].low - data[i].low;
    
    plusDM.push(highDiff > lowDiff && highDiff > 0 ? highDiff : 0);
    minusDM.push(lowDiff > highDiff && lowDiff > 0 ? lowDiff : 0);
    
    const trueRange = Math.max(
      data[i].high - data[i].low,
      Math.abs(data[i].high - data[i - 1].close),
      Math.abs(data[i].low - data[i - 1].close)
    );
    tr.push(trueRange);
  }
  
  // +DI, -DIを計算（Wilder's Smoothing）
  if (plusDM.length < period) {
    return { adx: [], plusDI: [], minusDI: [] };
  }
  
  let plusDMSum = plusDM.slice(0, period).reduce((a, b) => a + b, 0);
  let minusDMSum = minusDM.slice(0, period).reduce((a, b) => a + b, 0);
  let trSum = tr.slice(0, period).reduce((a, b) => a + b, 0);
  
  for (let i = period - 1; i < plusDM.length; i++) {
    if (i > period - 1) {
      plusDMSum = (plusDMSum * (period - 1) + plusDM[i]) / period;
      minusDMSum = (minusDMSum * (period - 1) + minusDM[i]) / period;
      trSum = (trSum * (period - 1) + tr[i]) / period;
    }
    
    const plusDIValue = trSum === 0 ? 0 : (plusDMSum / trSum) * 100;
    const minusDIValue = trSum === 0 ? 0 : (minusDMSum / trSum) * 100;
    
    plusDI.push({
      timestamp: data[i + 1].timestamp,
      value: plusDIValue,
    });
    minusDI.push({
      timestamp: data[i + 1].timestamp,
      value: minusDIValue,
    });
  }
  
  // DX, ADXを計算
  const dx: number[] = [];
  for (let i = 0; i < plusDI.length; i++) {
    const diSum = plusDI[i].value + minusDI[i].value;
    const diDiff = Math.abs(plusDI[i].value - minusDI[i].value);
    dx.push(diSum === 0 ? 0 : (diDiff / diSum) * 100);
  }
  
  if (dx.length < period) {
    return { adx, plusDI, minusDI };
  }
  
  let adxValue = dx.slice(0, period).reduce((a, b) => a + b, 0) / period;
  adx.push({
    timestamp: plusDI[period - 1].timestamp,
    value: adxValue,
  });
  
  for (let i = period; i < dx.length; i++) {
    adxValue = (adxValue * (period - 1) + dx[i]) / period;
    adx.push({
      timestamp: plusDI[i].timestamp,
      value: adxValue,
    });
  }
  
  return { adx, plusDI, minusDI };
}

/**
 * Parabolic SAR
 */
export function calculatePSAR(
  data: OHLCVDataPoint[],
  step: number = 0.02,
  max: number = 0.2
): IndicatorDataPoint[] {
  const result: IndicatorDataPoint[] = [];
  
  if (data.length < 2) return result;
  
  let trend: 'up' | 'down' = data[1].close > data[0].close ? 'up' : 'down';
  let sar = trend === 'up' ? data[0].low : data[0].high;
  let ep = trend === 'up' ? data[0].high : data[0].low;
  let af = step;
  
  result.push({
    timestamp: data[0].timestamp,
    value: sar,
  });
  
  for (let i = 1; i < data.length; i++) {
    const prevSar = sar;
    const prevEp = ep;
    const prevAf = af;
    
    // SAR計算
    sar = prevSar + prevAf * (prevEp - prevSar);
    
    if (trend === 'up') {
      if (data[i].low < sar) {
        trend = 'down';
        sar = prevEp;
        ep = data[i].low;
        af = step;
      } else {
        if (data[i].high > prevEp) {
          ep = data[i].high;
          af = Math.min(af + step, max);
        }
        sar = Math.min(sar, data[i - 1].low, data[i].low);
      }
    } else {
      if (data[i].high > sar) {
        trend = 'up';
        sar = prevEp;
        ep = data[i].high;
        af = step;
      } else {
        if (data[i].low < prevEp) {
          ep = data[i].low;
          af = Math.min(af + step, max);
        }
        sar = Math.max(sar, data[i - 1].high, data[i].high);
      }
    }
    
    result.push({
      timestamp: data[i].timestamp,
      value: sar,
    });
  }
  
  return result;
}

/**
 * Supertrend
 */
export function calculateSupertrend(
  data: OHLCVDataPoint[],
  period: number = 10,
  multiplier: number = 3.0
): IndicatorDataPoint[] {
  const result: IndicatorDataPoint[] = [];
  
  // ATRを計算
  const atr = calculateATR(data, period);
  if (atr.length === 0) return result;
  
  const hl2: number[] = data.map(d => (d.high + d.low) / 2);
  
  let trend: 'up' | 'down' = 'up';
  let prevTrend: 'up' | 'down' = trend;
  let prevUpperBand = 0;
  let prevLowerBand = 0;
  
  const atrStartIdx = period;
  for (let i = 0; i < atr.length; i++) {
    const dataIdx = i + atrStartIdx;
    if (dataIdx >= data.length) break;
    
    const upperBand = hl2[dataIdx] + multiplier * atr[i].value;
    const lowerBand = hl2[dataIdx] - multiplier * atr[i].value;
    
    const finalUpperBand = prevUpperBand === 0 || upperBand < prevUpperBand || data[dataIdx - 1].close > prevUpperBand
      ? upperBand
      : prevUpperBand;
    const finalLowerBand = prevLowerBand === 0 || lowerBand > prevLowerBand || data[dataIdx - 1].close < prevLowerBand
      ? lowerBand
      : prevLowerBand;
    
    if (data[dataIdx - 1].close <= prevLowerBand) {
      trend = 'down';
    } else if (data[dataIdx - 1].close >= prevUpperBand) {
      trend = 'up';
    } else {
      trend = prevTrend;
    }
    
    const supertrend = trend === 'up' ? finalLowerBand : finalUpperBand;
    
    result.push({
      timestamp: data[dataIdx].timestamp,
      value: supertrend,
    });
    
    prevTrend = trend;
    prevUpperBand = finalUpperBand;
    prevLowerBand = finalLowerBand;
  }
  
  return result;
}

/**
 * Ichimoku Cloud
 */
export function calculateIchimoku(
  data: OHLCVDataPoint[],
  tenkan: number = 9,
  kijun: number = 26,
  senkou: number = 52
): IchimokuResult {
  const tenkanLine: IndicatorDataPoint[] = [];
  const kijunLine: IndicatorDataPoint[] = [];
  const senkouA: IndicatorDataPoint[] = [];
  const senkouB: IndicatorDataPoint[] = [];
  const chikou: IndicatorDataPoint[] = [];
  
  // 転換線（Tenkan-sen）
  for (let i = tenkan - 1; i < data.length; i++) {
    const slice = data.slice(i - tenkan + 1, i + 1);
    const highest = Math.max(...slice.map(d => d.high));
    const lowest = Math.min(...slice.map(d => d.low));
    tenkanLine.push({
      timestamp: data[i].timestamp,
      value: (highest + lowest) / 2,
    });
  }
  
  // 基準線（Kijun-sen）
  for (let i = kijun - 1; i < data.length; i++) {
    const slice = data.slice(i - kijun + 1, i + 1);
    const highest = Math.max(...slice.map(d => d.high));
    const lowest = Math.min(...slice.map(d => d.low));
    kijunLine.push({
      timestamp: data[i].timestamp,
      value: (highest + lowest) / 2,
    });
  }
  
  // 先行スパンA（Senkou Span A）
  const senkouAOffset = kijun - 1;
  for (let i = 0; i < tenkanLine.length; i++) {
    const tenkanIdx = i + senkouAOffset;
    if (tenkanIdx < kijunLine.length) {
      senkouA.push({
        timestamp: data[i + kijun - 1].timestamp,
        value: (tenkanLine[tenkanIdx].value + kijunLine[i].value) / 2,
      });
    }
  }
  
  // 先行スパンB（Senkou Span B）
  for (let i = senkou - 1; i < data.length; i++) {
    const slice = data.slice(i - senkou + 1, i + 1);
    const highest = Math.max(...slice.map(d => d.high));
    const lowest = Math.min(...slice.map(d => d.low));
    senkouB.push({
      timestamp: data[i].timestamp,
      value: (highest + lowest) / 2,
    });
  }
  
  // 遅行スパン（Chikou Span）
  for (let i = 0; i < data.length; i++) {
    chikou.push({
      timestamp: data[i].timestamp,
      value: data[i].close,
    });
  }
  
  return { tenkan: tenkanLine, kijun: kijunLine, senkouA, senkouB, chikou };
}

/**
 * Keltner Channel
 */
export function calculateKeltnerChannel(
  data: OHLCVDataPoint[],
  period: number = 20,
  multiplier: number = 2.0
): { upper: IndicatorDataPoint[]; middle: IndicatorDataPoint[]; lower: IndicatorDataPoint[] } {
  const middle = calculateEMA(data, period);
  const atr = calculateATR(data, period);
  
  const upper: IndicatorDataPoint[] = [];
  const lower: IndicatorDataPoint[] = [];
  
  const atrStartIdx = period;
  for (let i = 0; i < middle.length; i++) {
    const dataIdx = i + period - 1;
    const atrIdx = dataIdx - atrStartIdx;
    
    if (atrIdx >= 0 && atrIdx < atr.length) {
      upper.push({
        timestamp: middle[i].timestamp,
        value: middle[i].value + multiplier * atr[atrIdx].value,
      });
      lower.push({
        timestamp: middle[i].timestamp,
        value: middle[i].value - multiplier * atr[atrIdx].value,
      });
    }
  }
  
  return { upper, middle, lower };
}

/**
 * OBV (On-Balance Volume)
 */
export function calculateOBV(
  data: OHLCVDataPoint[]
): IndicatorDataPoint[] {
  const result: IndicatorDataPoint[] = [];
  let obv = 0;
  
  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      obv = data[i].volume || 0;
    } else {
      if (data[i].close > data[i - 1].close) {
        obv += data[i].volume || 0;
      } else if (data[i].close < data[i - 1].close) {
        obv -= data[i].volume || 0;
      }
      // 同じ価格の場合はOBVは変わらない
    }
    
    result.push({
      timestamp: data[i].timestamp,
      value: obv,
    });
  }
  
  return result;
}

/**
 * VWAP (Volume Weighted Average Price)
 */
export function calculateVWAP(
  data: OHLCVDataPoint[]
): IndicatorDataPoint[] {
  const result: IndicatorDataPoint[] = [];
  let cumulativeTPV = 0; // Typical Price * Volume
  let cumulativeVolume = 0;
  
  for (let i = 0; i < data.length; i++) {
    const typicalPrice = (data[i].high + data[i].low + data[i].close) / 3;
    const volume = data[i].volume || 0;
    
    cumulativeTPV += typicalPrice * volume;
    cumulativeVolume += volume;
    
    const vwap = cumulativeVolume === 0 ? typicalPrice : cumulativeTPV / cumulativeVolume;
    result.push({
      timestamp: data[i].timestamp,
      value: vwap,
    });
  }
  
  return result;
}

/**
 * MFI (Money Flow Index)
 */
export function calculateMFI(
  data: OHLCVDataPoint[],
  period: number = 14
): IndicatorDataPoint[] {
  const result: IndicatorDataPoint[] = [];
  const moneyFlow: number[] = [];
  
  // 典型的価格とマネーフローを計算
  for (let i = 0; i < data.length; i++) {
    const typicalPrice = (data[i].high + data[i].low + data[i].close) / 3;
    const volume = data[i].volume || 0;
    moneyFlow.push(typicalPrice * volume);
  }
  
  // MFI計算
  for (let i = period; i < data.length; i++) {
    let positiveFlow = 0;
    let negativeFlow = 0;
    
    for (let j = i - period + 1; j <= i; j++) {
      const currentTP = (data[j].high + data[j].low + data[j].close) / 3;
      const prevTP = (data[j - 1].high + data[j - 1].low + data[j - 1].close) / 3;
      
      if (currentTP > prevTP) {
        positiveFlow += moneyFlow[j];
      } else if (currentTP < prevTP) {
        negativeFlow += moneyFlow[j];
      }
    }
    
    const moneyRatio = negativeFlow === 0 ? 100 : positiveFlow / negativeFlow;
    const mfi = 100 - (100 / (1 + moneyRatio));
    
    result.push({
      timestamp: data[i].timestamp,
      value: mfi,
    });
  }
  
  return result;
}

/**
 * CMF (Chaikin Money Flow)
 */
export function calculateCMF(
  data: OHLCVDataPoint[],
  period: number = 20
): IndicatorDataPoint[] {
  const result: IndicatorDataPoint[] = [];
  
  for (let i = period - 1; i < data.length; i++) {
    let sumMoneyFlowVolume = 0;
    let sumVolume = 0;
    
    for (let j = i - period + 1; j <= i; j++) {
      const moneyFlowMultiplier = data[j].high === data[j].low
        ? 0
        : ((data[j].close - data[j].low) - (data[j].high - data[j].close)) / (data[j].high - data[j].low);
      const volume = data[j].volume || 0;
      
      sumMoneyFlowVolume += moneyFlowMultiplier * volume;
      sumVolume += volume;
    }
    
    const cmf = sumVolume === 0 ? 0 : sumMoneyFlowVolume / sumVolume;
    result.push({
      timestamp: data[i].timestamp,
      value: cmf,
    });
  }
  
  return result;
}

/**
 * Pivot Points
 */
export function calculatePivotPoints(
  data: OHLCVDataPoint[]
): { pivot: IndicatorDataPoint[]; r1: IndicatorDataPoint[]; r2: IndicatorDataPoint[]; s1: IndicatorDataPoint[]; s2: IndicatorDataPoint[] } {
  const pivot: IndicatorDataPoint[] = [];
  const r1: IndicatorDataPoint[] = [];
  const r2: IndicatorDataPoint[] = [];
  const s1: IndicatorDataPoint[] = [];
  const s2: IndicatorDataPoint[] = [];
  
  // 前日のデータが必要なので、2日目から計算
  for (let i = 1; i < data.length; i++) {
    const prev = data[i - 1];
    const p = (prev.high + prev.low + prev.close) / 3;
    const r1Val = 2 * p - prev.low;
    const r2Val = p + (prev.high - prev.low);
    const s1Val = 2 * p - prev.high;
    const s2Val = p - (prev.high - prev.low);
    
    pivot.push({
      timestamp: data[i].timestamp,
      value: p,
    });
    r1.push({
      timestamp: data[i].timestamp,
      value: r1Val,
    });
    r2.push({
      timestamp: data[i].timestamp,
      value: r2Val,
    });
    s1.push({
      timestamp: data[i].timestamp,
      value: s1Val,
    });
    s2.push({
      timestamp: data[i].timestamp,
      value: s2Val,
    });
  }
  
  return { pivot, r1, r2, s1, s2 };
}

// ========================================
// チャート用変換ヘルパー
// ========================================

/** インジケーターカラー定義 */
const INDICATOR_COLORS = {
  sma: '#f59e0b',      // amber
  ema: '#3b82f6',      // blue
  dema: '#10b981',     // emerald
  tema: '#06b6d4',     // cyan
  rsi: '#8b5cf6',      // violet
  macd: '#ec4899',     // pink
  macdSignal: '#a855f7', // purple
  macdHistogram: '#22c55e', // green
  stochastic: '#f43f5e', // rose
  williamsR: '#fb7185', // rose-400
  cci: '#a78bfa',     // violet-400
  roc: '#fbbf24',     // amber-400
  aroon: '#34d399',   // emerald-400
  adx: '#60a5fa',     // blue-400
  psar: '#f59e0b',    // amber
  supertrend: '#14b8a6', // teal
  ichimoku: '#8b5cf6', // violet
  bbUpper: '#6366f1',  // indigo
  bbMiddle: '#8b5cf6', // violet
  bbLower: '#6366f1',  // indigo
  atr: '#f97316',      // orange
  kc: '#3b82f6',       // blue
  obv: '#22c55e',      // green
  vwap: '#6366f1',     // indigo
  mfi: '#ec4899',      // pink
  cmf: '#8b5cf6',      // violet
  pivot: '#f59e0b',    // amber
};

/**
 * SMAをチャート用設定に変換
 */
export function smaToChartConfig(
  data: OHLCVDataPoint[],
  period: number,
  id?: string,
  display?: { color?: string; lineWidth?: number; label?: string }
): IndicatorLineConfig {
  return {
    id: id || `sma-${period}`,
    name: display?.label || `SMA(${period})`,
    data: calculateSMA(data, period),
    color: display?.color || INDICATOR_COLORS.sma,
    lineWidth: display?.lineWidth || 2,
    pane: 'main',
  };
}

/**
 * EMAをチャート用設定に変換
 */
export function emaToChartConfig(
  data: OHLCVDataPoint[],
  period: number,
  id?: string,
  displaySettings?: { color?: string; lineWidth?: number; label?: string }
): IndicatorLineConfig {
  return {
    id: id || `ema-${period}`,
    name: displaySettings?.label || `EMA(${period})`,
    data: calculateEMA(data, period),
    color: displaySettings?.color || INDICATOR_COLORS.ema,
    lineWidth: displaySettings?.lineWidth || 2,
    pane: 'main',
  };
}

/**
 * RSIをチャート用設定に変換
 */
export function rsiToChartConfig(
  data: OHLCVDataPoint[],
  period: number = 14,
  id?: string,
  displaySettings?: { color?: string; lineWidth?: number; label?: string }
): IndicatorLineConfig {
  return {
    id: id || `rsi-${period}`,
    name: displaySettings?.label || `RSI(${period})`,
    data: calculateRSI(data, period),
    color: displaySettings?.color || INDICATOR_COLORS.rsi,
    lineWidth: displaySettings?.lineWidth || 2,
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
 * インジケーターIDとパラメータからチャート用設定を生成
 * 
 * @param indicatorId - インジケーターID
 * @param data - OHLCVデータ
 * @param params - 計算パラメータ
 * @param displaySettings - 表示設定（色、線の太さ、ラベル）
 */
export function indicatorToChartConfigs(
  indicatorId: string,
  data: OHLCVDataPoint[],
  params: Record<string, number> = {},
  displaySettings?: { color?: string; lineWidth?: number; label?: string }
): IndicatorLineConfig[] {
  const configs: IndicatorLineConfig[] = [];
  
  // デフォルト表示設定を取得（定義から）
  const definition = getIndicatorById(indicatorId);
  const defaultDisplay = definition?.defaultDisplay || { color: '#3b82f6', lineWidth: 2 };
  
  // 表示設定をマージ（ユーザー設定 > デフォルト）
  const finalDisplay = {
    color: displaySettings?.color || defaultDisplay.color,
    lineWidth: displaySettings?.lineWidth || defaultDisplay.lineWidth,
    label: displaySettings?.label,
  };
  
  try {
    switch (indicatorId) {
      case 'sma':
        configs.push(smaToChartConfig(data, params.period || 20, undefined, finalDisplay));
        break;
      case 'ema':
        configs.push(emaToChartConfig(data, params.period || 20, undefined, finalDisplay));
        break;
      case 'dema':
        configs.push({
          id: 'dema',
          name: finalDisplay.label || `DEMA(${params.period || 20})`,
          data: calculateDEMA(data, params.period || 20),
          color: finalDisplay.color,
          lineWidth: finalDisplay.lineWidth,
          pane: 'main',
        });
        break;
      case 'tema':
        configs.push({
          id: 'tema',
          name: finalDisplay.label || `TEMA(${params.period || 20})`,
          data: calculateTEMA(data, params.period || 20),
          color: finalDisplay.color,
          lineWidth: finalDisplay.lineWidth,
          pane: 'main',
        });
        break;
      case 'rsi':
        configs.push(rsiToChartConfig(data, params.period || 14, undefined, finalDisplay));
        break;
      case 'macd':
        configs.push(...macdToChartConfigs(
          data,
          params.fastPeriod || 12,
          params.slowPeriod || 26,
          params.signalPeriod || 9
        ));
        break;
      case 'stochastic': {
        const stoch = calculateStochastic(data, params.kPeriod || 14, params.dPeriod || 3);
        configs.push(
          {
            id: 'stoch-k',
            name: `%K(${params.kPeriod || 14})`,
            data: stoch.k,
            color: INDICATOR_COLORS.stochastic,
            pane: 'sub',
          },
          {
            id: 'stoch-d',
            name: `%D(${params.dPeriod || 3})`,
            data: stoch.d,
            color: INDICATOR_COLORS.macdSignal,
            pane: 'sub',
          }
        );
        break;
      }
      case 'williamsR':
        configs.push({
          id: 'williams-r',
          name: `Williams %R(${params.period || 14})`,
          data: calculateWilliamsR(data, params.period || 14),
          color: INDICATOR_COLORS.williamsR,
          pane: 'sub',
        });
        break;
      case 'cci':
        configs.push({
          id: 'cci',
          name: `CCI(${params.period || 20})`,
          data: calculateCCI(data, params.period || 20),
          color: INDICATOR_COLORS.cci,
          pane: 'sub',
        });
        break;
      case 'roc':
        configs.push({
          id: 'roc',
          name: `ROC(${params.period || 12})`,
          data: calculateROC(data, params.period || 12),
          color: INDICATOR_COLORS.roc,
          pane: 'sub',
        });
        break;
      case 'aroon': {
        const aroon = calculateAroon(data, params.period || 14);
        configs.push(
          {
            id: 'aroon-up',
            name: 'Aroon Up',
            data: aroon.aroonUp,
            color: INDICATOR_COLORS.aroon,
            pane: 'sub',
          },
          {
            id: 'aroon-down',
            name: 'Aroon Down',
            data: aroon.aroonDown,
            color: INDICATOR_COLORS.macdSignal,
            pane: 'sub',
          }
        );
        break;
      }
      case 'adx': {
        const adx = calculateADX(data, params.period || 14);
        configs.push(
          {
            id: 'adx',
            name: finalDisplay.label || `ADX(${params.period || 14})`,
            data: adx.adx,
            color: finalDisplay.color,
            lineWidth: finalDisplay.lineWidth,
            pane: 'sub',
          },
          {
            id: 'plus-di',
            name: '+DI',
            data: adx.plusDI,
            color: INDICATOR_COLORS.aroon,
            lineWidth: finalDisplay.lineWidth,
            pane: 'sub',
          },
          {
            id: 'minus-di',
            name: '-DI',
            data: adx.minusDI,
            color: INDICATOR_COLORS.williamsR,
            lineWidth: finalDisplay.lineWidth,
            pane: 'sub',
          }
        );
        break;
      }
      case 'psar':
        configs.push({
          id: 'psar',
          name: finalDisplay.label || 'Parabolic SAR',
          data: calculatePSAR(data, params.step || 0.02, params.max || 0.2),
          color: finalDisplay.color,
          lineWidth: finalDisplay.lineWidth,
          pane: 'main',
        });
        break;
      case 'supertrend':
        configs.push({
          id: 'supertrend',
          name: finalDisplay.label || 'Supertrend',
          data: calculateSupertrend(data, params.period || 10, params.multiplier || 3.0),
          color: finalDisplay.color,
          lineWidth: finalDisplay.lineWidth,
          pane: 'main',
        });
        break;
      case 'ichimoku': {
        const ichimoku = calculateIchimoku(
          data,
          params.tenkan || 9,
          params.kijun || 26,
          params.senkou || 52
        );
        configs.push(
          {
            id: 'ichimoku-tenkan',
            name: 'Tenkan',
            data: ichimoku.tenkan,
            color: INDICATOR_COLORS.ichimoku,
            pane: 'main',
          },
          {
            id: 'ichimoku-kijun',
            name: 'Kijun',
            data: ichimoku.kijun,
            color: INDICATOR_COLORS.macdSignal,
            pane: 'main',
          }
        );
        break;
      }
      case 'bb':
        configs.push(...bbToChartConfigs(data, params.period || 20, params.stdDev || 2));
        break;
      case 'atr':
        configs.push(atrToChartConfig(data, params.period || 14));
        break;
      case 'kc': {
        const kc = calculateKeltnerChannel(data, params.period || 20, params.multiplier || 2.0);
        configs.push(
          {
            id: 'kc-upper',
            name: 'KC Upper',
            data: kc.upper,
            color: INDICATOR_COLORS.kc,
            lineWidth: 1,
            pane: 'main',
          },
          {
            id: 'kc-middle',
            name: 'KC Middle',
            data: kc.middle,
            color: INDICATOR_COLORS.ema,
            lineWidth: 1,
            pane: 'main',
          },
          {
            id: 'kc-lower',
            name: 'KC Lower',
            data: kc.lower,
            color: INDICATOR_COLORS.kc,
            lineWidth: 1,
            pane: 'main',
          }
        );
        break;
      }
      case 'obv':
        configs.push({
          id: 'obv',
          name: 'OBV',
          data: calculateOBV(data),
          color: INDICATOR_COLORS.obv,
          pane: 'sub',
        });
        break;
      case 'vwap':
        configs.push({
          id: 'vwap',
          name: 'VWAP',
          data: calculateVWAP(data),
          color: INDICATOR_COLORS.vwap,
          pane: 'main',
        });
        break;
      case 'mfi':
        configs.push({
          id: 'mfi',
          name: `MFI(${params.period || 14})`,
          data: calculateMFI(data, params.period || 14),
          color: INDICATOR_COLORS.mfi,
          pane: 'sub',
        });
        break;
      case 'cmf':
        configs.push({
          id: 'cmf',
          name: `CMF(${params.period || 20})`,
          data: calculateCMF(data, params.period || 20),
          color: INDICATOR_COLORS.cmf,
          pane: 'sub',
        });
        break;
      case 'pivot': {
        const pivot = calculatePivotPoints(data);
        configs.push(
          {
            id: 'pivot',
            name: 'Pivot',
            data: pivot.pivot,
            color: INDICATOR_COLORS.pivot,
            pane: 'main',
          },
          {
            id: 'r1',
            name: 'R1',
            data: pivot.r1,
            color: INDICATOR_COLORS.aroon,
            lineWidth: 1,
            pane: 'main',
          },
          {
            id: 'r2',
            name: 'R2',
            data: pivot.r2,
            color: INDICATOR_COLORS.aroon,
            lineWidth: 1,
            pane: 'main',
          },
          {
            id: 's1',
            name: 'S1',
            data: pivot.s1,
            color: INDICATOR_COLORS.williamsR,
            lineWidth: 1,
            pane: 'main',
          },
          {
            id: 's2',
            name: 'S2',
            data: pivot.s2,
            color: INDICATOR_COLORS.williamsR,
            lineWidth: 1,
            pane: 'main',
          }
        );
        break;
      }
    }
  } catch (error) {
    console.warn(`[chartIndicators] インジケーター計算エラー (${indicatorId}):`, error);
  }
  
  return configs;
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
