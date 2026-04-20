/**
 * DSL 単純バー走査バックテスト（Phase 5）
 *
 * 既存 strategyBacktestService は DB 上の Strategy が必須のため、
 * DSL 専用に OHLCV 上で条件評価・約定をシミュレーションする。
 *
 * レンズ特徴量は「ohlcv」レンズに open/high/low/close/volume に加え、
 * 事前計算した rsi / atr を載せる。
 */

import { calculatePnl, calculateSummary } from '../../backend/services/backtestCalculations';
import type { BacktestResultSummary, BacktestTradeEvent, TradeSide } from '../../backend/services/backtestCalculations';
import type { LensFeature, LensFeatureSnapshot } from '../lenses/types';
import { DSLEvaluator } from './DSLEvaluator';
import type { StrategyDSL } from './schema';

/** ヒストリカル1本（strategyBacktestService.OHLCV と同形） */
export interface OhlcvBar {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface BarFeatureTable {
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
  rsi?: number[];
  atr?: number[];
}

/** シンボルに応じたおおよその 1pip 価格幅（最小版） */
export function defaultPipSizeForSymbol(symbol: string): number {
  const s = symbol.toUpperCase().replace(/[^A-Z]/g, '');
  if (s.includes('XAU') || s.includes('GOLD')) return 0.1;
  if (s.includes('JPY')) return 0.01;
  return 0.0001;
}

function computeSma(values: number[], period: number): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function computeRsi(closes: number[], period: number): number[] {
  const out: number[] = new Array(closes.length).fill(NaN);
  if (closes.length < period + 1) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = closes[i] - closes[i - 1];
    if (ch >= 0) gain += ch;
    else loss -= ch;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let i = period; i < closes.length; i++) {
    if (i > period) {
      const ch = closes[i] - closes[i - 1];
      const g = ch > 0 ? ch : 0;
      const l = ch < 0 ? -ch : 0;
      avgGain = (avgGain * (period - 1) + g) / period;
      avgLoss = (avgLoss * (period - 1) + l) / period;
    }
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    out[i] = 100 - 100 / (1 + rs);
  }
  return out;
}

function computeTrueRange(high: number[], low: number[], close: number[]): number[] {
  const tr: number[] = new Array(high.length).fill(0);
  for (let i = 0; i < high.length; i++) {
    if (i === 0) {
      tr[i] = high[i] - low[i];
    } else {
      tr[i] = Math.max(
        high[i] - low[i],
        Math.abs(high[i] - close[i - 1]),
        Math.abs(low[i] - close[i - 1]),
      );
    }
  }
  return tr;
}

function computeAtr(high: number[], low: number[], close: number[], period: number): number[] {
  const tr = computeTrueRange(high, low, close);
  return computeSma(tr, period);
}

function buildFeatureTable(bars: OhlcvBar[]): BarFeatureTable {
  const n = bars.length;
  const open = bars.map((b) => b.open);
  const high = bars.map((b) => b.high);
  const low = bars.map((b) => b.low);
  const close = bars.map((b) => b.close);
  const volume = bars.map((b) => b.volume);
  const rsi = computeRsi(close, 14);
  const atr = computeAtr(high, low, close, 14);
  return { open, high, low, close, volume, rsi, atr };
}

function snapshotAt(
  symbol: string,
  ts: Date,
  table: BarFeatureTable,
  i: number,
): LensFeatureSnapshot {
  const features = new Map<string, LensFeature>();
  const f: Record<string, number | string | boolean> = {
    open: table.open[i],
    high: table.high[i],
    low: table.low[i],
    close: table.close[i],
    volume: table.volume[i],
  };
  if (table.rsi && !Number.isNaN(table.rsi[i])) f.rsi = table.rsi[i]!;
  if (table.atr && !Number.isNaN(table.atr[i])) f.atr = table.atr[i]!;

  features.set('ohlcv', {
    lensName: 'ohlcv',
    lensVersion: '1.0.0',
    features: f,
    computedAt: ts,
  });

  return {
    timestamp: ts,
    symbol,
    features,
    totalComputeDurationMs: 0,
  };
}

function resolveNum(
  dsl: StrategyDSL,
  v: number | string,
  paramValues: Record<string, number>,
  evaluator: DSLEvaluator,
): number {
  const x = evaluator.resolveParam(v, paramValues);
  return typeof x === 'number' ? x : Number(x);
}

/** ストップ幅（価格差・ロング基準で正） */
function stopDistance(
  dsl: StrategyDSL,
  table: BarFeatureTable,
  i: number,
  pipSize: number,
  paramValues: Record<string, number>,
  evalr: DSLEvaluator,
): number {
  const sl = dsl.stopLoss;
  if (sl.type === 'fixed_pips') {
    const pips = resolveNum(dsl, sl.value, paramValues, evalr);
    return pips * pipSize;
  }
  if (sl.type === 'atr_multiple') {
    const atr = table.atr?.[i];
    if (atr === undefined || Number.isNaN(atr)) return table.close[i] * 0.01;
    const mult = resolveNum(dsl, sl.value, paramValues, evalr);
    return atr * mult;
  }
  // swing_point: 過去バーの安値との距離（ロング）
  const lb = Math.floor(resolveNum(dsl, sl.lookbackBars, paramValues, evalr));
  let windowLow = table.low[i];
  for (let k = Math.max(0, i - lb); k < i; k++) {
    windowLow = Math.min(windowLow, table.low[k]);
  }
  return table.close[i] - windowLow;
}

function takeProfitDistance(
  dsl: StrategyDSL,
  stopDist: number,
  table: BarFeatureTable,
  i: number,
  pipSize: number,
  paramValues: Record<string, number>,
  evalr: DSLEvaluator,
): number {
  const tp = dsl.takeProfit;
  if (tp.type === 'rr_ratio') {
    const rr = resolveNum(dsl, tp.value, paramValues, evalr);
    return stopDist * rr;
  }
  if (tp.type === 'fixed_pips') {
    return resolveNum(dsl, tp.value, paramValues, evalr) * pipSize;
  }
  const atr = table.atr?.[i] ?? table.close[i] * 0.01;
  const mult = resolveNum(dsl, tp.value, paramValues, evalr);
  return atr * mult;
}

export interface DslSimulationResult {
  summary: BacktestResultSummary;
  trades: BacktestTradeEvent[];
}

/**
 * OHLCV 列に対して DSL を実行しトレード列・サマリーを返す
 */
export function runDslSimulation(
  bars: OhlcvBar[],
  dsl: StrategyDSL,
  paramValues: Record<string, number>,
  options?: { initialCapital?: number; lotSize?: number },
): DslSimulationResult {
  const evaluator = new DSLEvaluator();
  const initialCapital = options?.initialCapital ?? 10_000;
  const lotSize = options?.lotSize ?? 10_000;

  if (bars.length < 20) {
    const empty = calculateSummary([], initialCapital);
    return { summary: empty, trades: [] };
  }

  const table = buildFeatureTable(bars);
  const pipSize = defaultPipSizeForSymbol(dsl.symbol);
  const symbolNorm = dsl.symbol.replace(/\//g, '');

  const events: BacktestTradeEvent[] = [];
  let position:
    | {
        side: TradeSide;
        entryIndex: number;
        entryPrice: number;
        sl: number;
        tp: number;
      }
    | null = null;

  const startI = 15;

  for (let i = startI; i < bars.length; i++) {
    const ts = bars[i].timestamp;
    const snap = snapshotAt(symbolNorm, ts, table, i);

    if (position) {
      const { side, entryPrice, sl, tp, entryIndex } = position;
      const bar = bars[i];
      let exitPrice: number | null = null;
      let reason: 'take_profit' | 'stop_loss' | 'signal' = 'signal';

      if (side === 'buy') {
        if (bar.low <= sl) {
          exitPrice = sl;
          reason = 'stop_loss';
        } else if (bar.high >= tp) {
          exitPrice = tp;
          reason = 'take_profit';
        }
      } else {
        if (bar.high >= sl) {
          exitPrice = sl;
          reason = 'stop_loss';
        } else if (bar.low <= tp) {
          exitPrice = tp;
          reason = 'take_profit';
        }
      }

      if (exitPrice !== null) {
        const pnl = calculatePnl(side, entryPrice, exitPrice, lotSize);
        events.push({
          eventId: `${dsl.id}-${entryIndex}-${i}`,
          entryTime: bars[entryIndex].timestamp.toISOString(),
          entryPrice,
          exitTime: bar.timestamp.toISOString(),
          exitPrice,
          side,
          lotSize,
          pnl,
          pnlPercent: (pnl / initialCapital) * 100,
          exitReason: reason,
        });
        position = null;
      }
    }

    if (!position && i < bars.length - 1) {
      const entryOk = evaluator.evaluateConditions(dsl.entry.trigger, snap, paramValues);
      if (entryOk) {
        const closePx = bars[i].close;
        const stopDist = stopDistance(dsl, table, i, pipSize, paramValues, evaluator);
        const tpDist = takeProfitDistance(dsl, stopDist, table, i, pipSize, paramValues, evaluator);
        if (dsl.entry.direction === 'long') {
          position = {
            side: 'buy',
            entryIndex: i,
            entryPrice: closePx,
            sl: closePx - stopDist,
            tp: closePx + tpDist,
          };
        } else {
          position = {
            side: 'sell',
            entryIndex: i,
            entryPrice: closePx,
            sl: closePx + stopDist,
            tp: closePx - tpDist,
          };
        }
      }
    }
  }

  const summary = calculateSummary(events, initialCapital);
  return { summary, trades: events };
}
