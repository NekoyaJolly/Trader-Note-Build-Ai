/**
 * TS surrogate 用の indicator 計算 adapter (PR #116b)。
 *
 * Side-A の `IndicatorService` (indicatorts 由来) を Side-B の bar-by-bar
 * simulation で使えるよう正規化する。
 *
 * indicatorts は warm-up period 分のデータを切り捨てた配列を返すため
 * (例: 100 本の close + RSI(14) → 86 個の出力)、Side-B 側で arr[i] による
 * i-th bar lookup ができない。本 adapter は **leading NaN padding** で配列長を
 * `bars.close.length` に揃える。
 *
 * v1 (= PR #116b) では以下 6 個の indicator を tsSurrogate=true として提供:
 *   - ema, sma, rsi, atr (それぞれ単一 series)
 *   - macd (macdLine のみ、signal/histogram は将来 PR)
 *   - bb (middleBand のみ、upper/lower は将来 PR)
 *
 * macd/bb の派生 series (signal, histogram, upper, lower 等) や、stochastic /
 * cci / williamsR 等の追加 indicator は registry の `support.tsSurrogate=false`
 * のままで、後続 PR で順次拡張する。
 */

import { indicatorService } from '../../services/indicators/indicatorService';
import type { ConditionParams } from './schema';

/** bar-by-bar simulation で必要な OHLCV 列。 */
export interface BarSeries {
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
}

/**
 * indicatorts 由来の値配列 (= 末尾 N 個のみ返る) を、bar 総数に合わせて
 * 先頭を NaN で padding する。
 *
 * @param values 計算済み indicator 値 (warm-up 期間が切り捨てられた配列)
 * @param totalBars bar の総数 (= padding 後の目標長)
 */
export function padLeadingNaN(values: number[], totalBars: number): number[] {
  if (totalBars <= 0) return [];
  const missing = totalBars - values.length;
  if (missing <= 0) {
    // 既に足りている / 多すぎる場合は末尾 totalBars 個に揃える
    return values.slice(values.length - totalBars);
  }
  const padded = new Array<number>(totalBars);
  for (let i = 0; i < missing; i++) padded[i] = NaN;
  for (let i = 0; i < values.length; i++) padded[missing + i] = values[i];
  return padded;
}

/** PR #116b で TS surrogate が計算可能な indicator feature 名。 */
export const TS_SURROGATE_INDICATOR_FEATURES = ['ema', 'sma', 'rsi', 'atr', 'macd', 'bb'] as const;
export type TsSurrogateIndicatorFeature = (typeof TS_SURROGATE_INDICATOR_FEATURES)[number];

export function isTsSurrogateIndicatorFeature(feature: string): feature is TsSurrogateIndicatorFeature {
  return (TS_SURROGATE_INDICATOR_FEATURES as readonly string[]).includes(feature);
}

/**
 * `lens.feature(params)` から padded indicator series を計算して返す。
 *
 * PR #116b では `lens='ohlcv'` のみ対応。サポート外 lens / feature には null を返す
 * (= 評価器側で「未対応 → false leaf」として扱われる)。
 *
 * @param feature indicator 名 (ema/sma/rsi/atr/macd/bb のいずれか)
 * @param params indicator パラメータ (period 等)、未指定時はデフォルト値
 * @param bars OHLCV 列
 */
export function computeTsSurrogateIndicator(
  feature: string,
  params: ConditionParams | undefined,
  bars: BarSeries,
): number[] | null {
  if (!isTsSurrogateIndicatorFeature(feature)) return null;
  const N = bars.close.length;
  if (N === 0) return [];
  const p = params ?? {};

  switch (feature) {
    case 'ema': {
      const period = positiveIntegerOrDefault(p.period, 20);
      return padLeadingNaN(indicatorService.calculateEMA(bars.close, period), N);
    }
    case 'sma': {
      const period = positiveIntegerOrDefault(p.period, 20);
      return padLeadingNaN(indicatorService.calculateSMA(bars.close, period), N);
    }
    case 'rsi': {
      const period = positiveIntegerOrDefault(p.period, 14);
      return padLeadingNaN(indicatorService.calculateRSI(bars.close, period), N);
    }
    case 'atr': {
      const period = positiveIntegerOrDefault(p.period, 14);
      const r = indicatorService.calculateATR(bars.high, bars.low, bars.close, period);
      return padLeadingNaN(r.atrLine, N);
    }
    case 'macd': {
      // PR #116b では macd の主出力 (macdLine) のみ。signal/histogram は将来 PR で拡張。
      const fast = positiveIntegerOrDefault(p.fastPeriod, 12);
      const slow = positiveIntegerOrDefault(p.slowPeriod, 26);
      const signal = positiveIntegerOrDefault(p.signalPeriod, 9);
      const r = indicatorService.calculateMACD(bars.close, fast, slow, signal);
      return padLeadingNaN(r.macdLine, N);
    }
    case 'bb': {
      // PR #116b では bb の middleBand のみ。upper/lower は将来 PR で拡張。
      const period = positiveIntegerOrDefault(p.period, 20);
      const r = indicatorService.calculateBollingerBands(bars.close, period);
      return padLeadingNaN(r.middleBand, N);
    }
  }
}

/**
 * 期間系パラメータ用の正規化。
 *
 * PR #120 Copilot review #4: indicatorts は `period` 等を int として受けるが、
 * 旧実装は finite 数値ならそのまま渡していたため、20.5 が渡ると indicatorts 側で
 * `Math.trunc` 的に切り捨てられて snapshot key と不一致になっていた。
 *
 * 本来 schema (`ConditionParamsSchema.superRefine`) で弾く規約だが、TS surrogate
 * 単体テストで schema parse を経由しない経路を考慮し、defensive に「正の整数で
 * なければ fallback」に倒す。
 */
function positiveIntegerOrDefault(v: number | undefined, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isInteger(v) || v <= 0) {
    return fallback;
  }
  return v;
}

