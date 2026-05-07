/**
 * SurrogateFitnessSimulation (Critical-4 段階 4a で `dslBacktestSimulation.ts` から改名)
 *
 * **これは進化計算 (EvolutionLoop) 用の近似 fitness 評価であり、正式な BT 結果ではない**。
 *
 * DSL 戦略を OHLCV バー上で素朴に走査し、条件評価・約定をシミュレーションする。
 * `SurrogateFitnessSimulator` から呼ばれる内部実装。
 *
 * レンズ特徴量は「ohlcv」レンズに open/high/low/close/volume + 事前計算 rsi / atr を載せる。
 *
 * **本番採用 / confirmed 昇格 / ユーザー表示** は analysis-engine の結果 (ScreeningBacktestRun)
 * のみを正とする (Critical-4 設計書 §13)。
 *
 * @see docs/design/critical_4_bt_unification.md §13
 */

import { calculatePnl, calculateSummary } from '../../backend/services/backtestCalculations';
import type { BacktestResultSummary, BacktestTradeEvent, TradeSide } from '../../backend/services/backtestCalculations';
import type { LensFeature, LensFeatureSnapshot } from '../lenses/types';
import {
  collectDslIndicatorNeeds,
  collectDslOhlcvFeatureNeeds,
  collectDslPatternNeed,
  type DslIndicatorNeed,
} from './dslOhlcvFeatureNeeds';
import {
  ALL_CANDLE_PATTERN_IDS,
  type CandlePatternId,
} from '../../shared/patterns';
import { DSLEvaluator } from './DSLEvaluator';
import type {
  ExecutionCostSummary,
  ExecutionDataSource,
  ExecutionModel,
  ExecutionSimulationMetadata,
} from './executionSimulation';
// PR ④F: 旧 `computeTsSurrogateIndicator` (= TS で indicator を計算する経路) は撤廃。
// 全 indicator は analysis-engine `/v1/indicator-series` から取得し、
// `DslSimulationOptions.indicatorSeriesCache` 経由で本ファイルに渡される。
import type { StrategyDSL } from './schema';
import { isWaitForTriggerEntry } from './types';

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
  /**
   * PR #116b: params 付き / 新 indicator (ema/sma/macd/bb 等) の series を
   * **snapshot key (= `${lens}.${feature}` または `${lens}.${feature}(stable_params)`、
   * lens を含む形)** で格納する。`snapshotAt` が lens prefix (`ohlcv.`) を剥がして
   * features Map の feature key 部分を構築する。
   *
   * params なしの ohlcv.rsi / ohlcv.atr は legacy パスの `rsi` / `atr` フィールド
   * (period=14 既定) で扱う (= `collectDslIndicatorNeeds` 側で除外済み、indicatorts
   * 由来の値で上書きしないことで後方互換を保つ)。
   */
  indicatorSeries?: Map<string, number[]>;
  /**
   * PR ②-1: ローソク足パターン真偽配列。`computeAllPatternFlags` で全バー分を
   * 1 度に計算しておき、`snapshotAt(i)` で i 番目を引いて pattern lens features
   * を構築する。DSL が pattern lens を参照しないなら未設定 (= 計算スキップ)。
   */
  patternFlags?: Record<CandlePatternId, boolean[]>;
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

function buildFeatureTable(
  bars: OhlcvBar[],
  needs: { rsi: boolean; atr: boolean },
  indicatorNeeds: readonly DslIndicatorNeed[] = [],
  patternNeeded: boolean = false,
  indicatorSeriesCache?: DslSimulationOptions['indicatorSeriesCache'],
  patternFlagsCache?: DslSimulationOptions['patternFlagsCache'],
): BarFeatureTable {
  const open = bars.map((b) => b.open);
  const high = bars.map((b) => b.high);
  const low = bars.map((b) => b.low);
  const close = bars.map((b) => b.close);
  const volume = bars.map((b) => b.volume);
  const table: BarFeatureTable = { open, high, low, close, volume };
  if (needs.rsi) {
    table.rsi = computeRsi(close, 14);
  }
  if (needs.atr) {
    table.atr = computeAtr(high, low, close, 14);
  }
  // PR ④F: 動的 indicator series は **analysis-engine HTTP 経由のキャッシュから引く**。
  // EvolutionLoop が世代開始時に `fetchIndicatorSeries` で取得して `indicatorSeriesCache`
  // に詰めて渡す前提。キャッシュ未指定 / 該当キー欠落時は indicator series を Map に
  // 積まず leaf 評価で false に倒れる (= legacy TS 計算経路は撤廃)。
  if (indicatorNeeds.length > 0) {
    const series = new Map<string, number[]>();
    for (const need of indicatorNeeds) {
      const cached = indicatorSeriesCache?.get(need.snapshotKey);
      if (!cached) continue;
      // PR ④F Copilot review: bars.length まで NaN padding する (= pattern 側と
      // 対称な扱い)。キャッシュが短い場合は末尾に NaN を埋め、leaf 評価で「値なし」
      // (= isNaN チェックで false 扱い) になる。長すぎる場合は bars 長で打ち切り。
      const values = new Array<number>(bars.length);
      const copyLen = Math.min(cached.length, bars.length);
      for (let i = 0; i < copyLen; i++) {
        const v = cached[i];
        values[i] = v === null || v === undefined ? Number.NaN : v;
      }
      for (let i = copyLen; i < bars.length; i++) {
        values[i] = Number.NaN;
      }
      series.set(need.snapshotKey, values);
    }
    table.indicatorSeries = series;
  }
  // PR ②-1 + PR ④F: pattern lens 参照ありなら、analysis-engine HTTP 経由の
  // patternFlagsCache から 12 種 boolean 配列を取り出す。キャッシュ未指定で
  // pattern が必要な場合は features 未積みになり leaf は false 評価。
  if (patternNeeded && patternFlagsCache) {
    const patternFlags = {} as Record<CandlePatternId, boolean[]>;
    for (const id of ALL_CANDLE_PATTERN_IDS) {
      const arr = patternFlagsCache[id];
      if (!arr) {
        patternFlags[id] = new Array<boolean>(bars.length).fill(false);
        continue;
      }
      const len = Math.min(arr.length, bars.length);
      const values = new Array<boolean>(len);
      for (let i = 0; i < len; i++) {
        values[i] = Boolean(arr[i]);
      }
      // arr が短い場合は末尾を false で詰める
      for (let i = len; i < bars.length; i++) values[i] = false;
      patternFlags[id] = values;
    }
    table.patternFlags = patternFlags;
  }
  return table;
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
  // PR #116b: 新 indicator series を snapshot.features に snapshot key 形式で詰める。
  // snapshotKey は `${lens}.${feature}(stable_params)` だが、snapshot.features の key は
  // lens prefix を取り除いた `feature(stable_params)` 形式 (lens 自体は features Map の key)。
  if (table.indicatorSeries) {
    for (const [snapshotKey, series] of table.indicatorSeries) {
      const v = series[i];
      if (typeof v === 'number' && !Number.isNaN(v)) {
        // snapshotKey の lens prefix (`ohlcv.`) を取り除いて feature key 部分のみ使う
        const featureKey = snapshotKey.startsWith('ohlcv.')
          ? snapshotKey.slice('ohlcv.'.length)
          : snapshotKey;
        f[featureKey] = v;
      }
    }
  }

  features.set('ohlcv', {
    lensName: 'ohlcv',
    lensVersion: '1.0.0',
    features: f,
    computedAt: ts,
  });

  // PR ②-1: pattern lens features (= 12 種ローソク足パターン真偽) を詰める。
  // patternFlags が未設定 (= DSL が pattern lens を参照しない) なら lens 自体を
  // 登録しない (= DSLEvaluator.lookupOperand で features.get('pattern') が undefined
  // → leaf は false 評価)。
  if (table.patternFlags) {
    const pf: Record<string, boolean> = {};
    for (const id of ALL_CANDLE_PATTERN_IDS) {
      const arr = table.patternFlags[id];
      pf[id] = arr ? Boolean(arr[i]) : false;
    }
    features.set('pattern', {
      lensName: 'pattern',
      lensVersion: '1.0.0',
      features: pf,
      computedAt: ts,
    });
  }

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

/** 同バー内に SL/TP 両方が到達した場合の解釈（到達仮定の違い） */
export type IntraBarExitMode = 'pessimistic' | 'optimistic';

/** 即時エントリー（trigger）の約定タイミング */
export type ImmediateEntryFill = 'signal_bar_close' | 'next_bar_open';

/**
 * シミュレーションの仮定（精度・執行モデル）を上書きする。
 * 未指定時は従来互換: 同バーは SL 優先（悲観）、即時はシグナル足終値、往復スプレッドなし。
 */
export interface DslSimulationOptions {
  initialCapital?: number;
  lotSize?: number;
  /** 同バー内の SL/TP 判定順。デフォルト: pessimistic */
  intraBarExitMode?: IntraBarExitMode;
  /** 即時 trigger の建値。デフォルト: signal_bar_close */
  immediateEntryFill?: ImmediateEntryFill;
  /** 往復を pips 換算で仮定した取引コスト（スプレッド＋手数料の簡易表現）。0 未満は無効 */
  roundTripCostPips?: number;
  /**
   * 往復コストのうち、エントリー足の ATR(14) に比例する分の係数。
   * 加算額: `roundTripCostAtrMult * ATR[entryIndex] * lotSize`（価格×ロット＝P/L と同次元）
   * ボラ拡大時のスリッページ・拡大スプを粗く表す。DSL が ATR 未使用でも内部で ATR を計算する。
   */
  roundTripCostAtrMult?: number;
  /** Phase 6.8: 監査用メタデータ（未指定時は legacy_zero_cost として扱う） */
  executionModel?: ExecutionModel;
  executionConfigHash?: string;
  executionDataSource?: ExecutionDataSource;
  /**
   * PR ④F: analysis-engine `/v1/indicator-series` から取得した indicator 値配列の
   * 世代スコープキャッシュ。key は **DSL snapshot key 形式** (`${lens}.${feature}` /
   * `${lens}.${feature}(stable_params)`)、value は bar 数と同じ長さの数値配列
   * (warm-up は null)。
   *
   * 渡されていれば surrogate は内部で indicator 計算を **行わず**、本キャッシュから
   * 値を引いて snapshot に詰める。`EvolutionLoop` が世代開始時に全候補が必要とする
   * indicator を一括 HTTP 取得して構築する。
   *
   * 未指定 (= legacy 経路) では DSL に indicator 条件があっても snapshot にその
   * 値が積まれず leaf 評価で false に倒れるため、indicator を使う戦略を評価する
   * 場合は **必ず指定** すること。
   */
  indicatorSeriesCache?: ReadonlyMap<string, ReadonlyArray<number | null>>;
  /**
   * PR ④F: analysis-engine `/v1/indicator-series` から取得した pattern flag 配列の
   * 世代スコープキャッシュ。key は `CandlePatternId` (`pinbar` / `engulfing_bull` 等)、
   * value は bar 数と同じ長さの boolean 配列。
   *
   * 未指定で DSL が pattern lens を参照する場合、pattern features が snapshot に
   * 積まれず is_true / is_false leaf が常に false になる。
   */
  patternFlagsCache?: Readonly<Record<CandlePatternId, ReadonlyArray<boolean>>>;
}

/**
 * 同バー内で SL と TP のどちらに触れるか解決（ヒゲのみの順序仮定）
 */
function resolveIntraBarExit(
  side: TradeSide,
  bar: OhlcvBar,
  sl: number,
  tp: number,
  mode: IntraBarExitMode,
): { exitPrice: number; reason: 'take_profit' | 'stop_loss' } | null {
  if (side === 'buy') {
    const hitSl = bar.low <= sl;
    const hitTp = bar.high >= tp;
    if (!hitSl && !hitTp) return null;
    if (mode === 'pessimistic') {
      if (hitSl) return { exitPrice: sl, reason: 'stop_loss' };
      return { exitPrice: tp, reason: 'take_profit' };
    }
    if (hitTp) return { exitPrice: tp, reason: 'take_profit' };
    return { exitPrice: sl, reason: 'stop_loss' };
  }
  const hitSl = bar.high >= sl;
  const hitTp = bar.low <= tp;
  if (!hitSl && !hitTp) return null;
  if (mode === 'pessimistic') {
    if (hitSl) return { exitPrice: sl, reason: 'stop_loss' };
    return { exitPrice: tp, reason: 'take_profit' };
  }
  if (hitTp) return { exitPrice: tp, reason: 'take_profit' };
  return { exitPrice: sl, reason: 'stop_loss' };
}

function applyRoundTripPips(
  rawPnl: number,
  pipSize: number,
  lotSize: number,
  roundTripCostPips: number | undefined,
): number {
  if (roundTripCostPips === undefined || roundTripCostPips <= 0) return rawPnl;
  const c = roundTripCostPips * pipSize * lotSize;
  return rawPnl - c;
}

/** pips コスト + エントリー時点 ATR 比例コスト */
function applyTransactionCosts(
  rawPnl: number,
  pipSize: number,
  lotSize: number,
  roundTripCostPips: number | undefined,
  roundTripCostAtrMult: number | undefined,
  table: BarFeatureTable,
  entryIndex: number,
): number {
  let pnl = applyRoundTripPips(rawPnl, pipSize, lotSize, roundTripCostPips);
  if (roundTripCostAtrMult === undefined || roundTripCostAtrMult <= 0) return pnl;
  const atr = table.atr?.[entryIndex];
  if (atr === undefined || Number.isNaN(atr) || atr <= 0) return pnl;
  pnl -= roundTripCostAtrMult * atr * lotSize;
  return pnl;
}

function halfAdverseExecutionCostDistance(
  pipSize: number,
  roundTripCostPips: number | undefined,
  roundTripCostAtrMult: number | undefined,
  table: BarFeatureTable,
  entryIndex: number,
): number {
  const pipsCost = Math.max(0, roundTripCostPips ?? 0) * pipSize;
  const atr = table.atr?.[entryIndex];
  const atrCost =
    atr !== undefined && !Number.isNaN(atr) && atr > 0
      ? Math.max(0, roundTripCostAtrMult ?? 0) * atr
      : 0;
  return (pipsCost + atrCost) / 2;
}

function adjustEntryPrice(
  side: TradeSide,
  price: number,
  halfCostDistance: number,
): number {
  return side === 'buy' ? price + halfCostDistance : price - halfCostDistance;
}

function adjustExitPrice(
  side: TradeSide,
  price: number,
  halfCostDistance: number,
): number {
  return side === 'buy' ? price - halfCostDistance : price + halfCostDistance;
}

export interface DslSimulationResult {
  summary: BacktestResultSummary;
  trades: BacktestTradeEvent[];
  execution: ExecutionSimulationMetadata;
}

/**
 * OHLCV 列に対して DSL を実行しトレード列・サマリーを返す
 */
export function runDslSimulation(
  bars: OhlcvBar[],
  dsl: StrategyDSL,
  paramValues: Record<string, number>,
  options?: DslSimulationOptions,
): DslSimulationResult {
  const evaluator = new DSLEvaluator();
  const initialCapital = options?.initialCapital ?? 10_000;
  const lotSize = options?.lotSize ?? 10_000;
  const exitMode: IntraBarExitMode = options?.intraBarExitMode ?? 'pessimistic';
  const immediateFill: ImmediateEntryFill = options?.immediateEntryFill ?? 'signal_bar_close';
  const roundTripCostPips = options?.roundTripCostPips;
  const roundTripCostAtrMult = options?.roundTripCostAtrMult;
  const executionModel: ExecutionModel = options?.executionModel ?? 'legacy_zero_cost';
  const executionConfigHash = options?.executionConfigHash ?? 'legacy-zero-cost';
  const executionDataSource: ExecutionDataSource = options?.executionDataSource ?? 'ctrader';

  const featureNeeds = collectDslOhlcvFeatureNeeds(dsl);
  const indicatorNeeds = collectDslIndicatorNeeds(dsl);
  const patternNeeded = collectDslPatternNeed(dsl);
  const needAtrForTransactionCost = (roundTripCostAtrMult ?? 0) > 0;
  // PR #116b Copilot review #1:
  // needWarmup から indicatorNeeds を除外する。短期 indicator (例: ema(5)) でも
  // minLen=20 が適用されると初期バーのエントリ機会を丸ごとスキップしてしまう。
  // indicator 系列は warm-up 期間中 NaN で snapshotAt が値なし扱い → leaf が false
  // になるので、minLen 強制は legacy rsi/atr/取引コスト用途に限定する。
  const needWarmup = featureNeeds.rsi || featureNeeds.atr || needAtrForTransactionCost;
  const minLen = needWarmup ? 20 : 2;
  if (bars.length < minLen) {
    const empty = calculateSummary([], initialCapital);
    return {
      summary: empty,
      trades: [],
      execution: {
        executionModel,
        executionConfigHash,
        dataSource: executionDataSource,
        costSummary: {
          model: executionModel,
          dataSource: executionDataSource,
          roundTripCostPips: Math.max(0, roundTripCostPips ?? 0),
          roundTripCostAtrMult: Math.max(0, roundTripCostAtrMult ?? 0),
          totalCost: 0,
        },
      },
    };
  }

  const table = buildFeatureTable(
    bars,
    {
      rsi: featureNeeds.rsi,
      atr: featureNeeds.atr || needAtrForTransactionCost,
    },
    indicatorNeeds,
    patternNeeded,
    options?.indicatorSeriesCache,
    options?.patternFlagsCache,
  );
  const pipSize = defaultPipSizeForSymbol(dsl.symbol);
  const symbolNorm = dsl.symbol.replace(/\//g, '');

  const events: BacktestTradeEvent[] = [];
  let totalCost = 0;
  let position:
    | {
        side: TradeSide;
        entryIndex: number;
        entryPrice: number;
        grossEntryPrice: number;
        sl: number;
        tp: number;
      }
    | null = null;

  // RSI/ATR 未使用時は先頭足から条件評価可能（1 分足の履歴短いケース用）
  const startI = needWarmup ? 15 : 0;
  const isWait = isWaitForTriggerEntry(dsl.entry);
  /** wait_for_trigger: 当バーからの相対。null は未アーム */
  let waitStart: number | null = null;
  /** 待機期限超過で打ち切り（その後は新規待機・エントリーしない） */
  let waitAborted = false;
  /** 即時 trigger + next_bar_open: シグナル足 index → 次足始値で建てる */
  let deferredImmediate: { openAtIndex: number; isLong: boolean } | null = null;

  // PR ①-B: cross / Touch 系 op のため前バー snapshot を保持。
  // 先頭バー (= prevSnap=undefined) では状態遷移系 leaf は false に倒される。
  // PR ①-B Copilot review #2: 毎バー snapshotAt を 2 回呼ぶと indicatorSeries
  // 全走査が 2 回走るため、前ループの snap を prevSnap に使い回して 1 回/バーに抑える。
  let prevSnap: LensFeatureSnapshot | undefined = undefined;
  for (let i = startI; i < bars.length; i++) {
    const ts = bars[i].timestamp;
    const snap = snapshotAt(symbolNorm, ts, table, i);

    if (!position && deferredImmediate && i === deferredImmediate.openAtIndex) {
      const e = dsl.entry;
      if (!('trigger' in e)) {
        // PR #116b lint fix: deferredImmediate への代入は break で抜けるため意味がない
        break;
      }
      const j = i;
      const openPx = bars[j].open;
      const stopDist = stopDistance(dsl, table, j, pipSize, paramValues, evaluator);
      const tpDist = takeProfitDistance(dsl, stopDist, table, j, pipSize, paramValues, evaluator);
      if (deferredImmediate.isLong) {
        const halfCost = executionModel === 'bar_l2_v1'
          ? halfAdverseExecutionCostDistance(
              pipSize,
              roundTripCostPips,
              roundTripCostAtrMult,
              table,
              j,
            )
          : 0;
        position = {
          side: 'buy',
          entryIndex: j,
          entryPrice: adjustEntryPrice('buy', openPx, halfCost),
          grossEntryPrice: openPx,
          sl: openPx - stopDist,
          tp: openPx + tpDist,
        };
      } else {
        const halfCost = executionModel === 'bar_l2_v1'
          ? halfAdverseExecutionCostDistance(
              pipSize,
              roundTripCostPips,
              roundTripCostAtrMult,
              table,
              j,
            )
          : 0;
        position = {
          side: 'sell',
          entryIndex: j,
          entryPrice: adjustEntryPrice('sell', openPx, halfCost),
          grossEntryPrice: openPx,
          sl: openPx + stopDist,
          tp: openPx - tpDist,
        };
      }
      deferredImmediate = null;
    }

    if (position) {
      const { side, entryPrice, grossEntryPrice, sl, tp, entryIndex } = position;
      const bar = bars[i];
      const resolved = resolveIntraBarExit(side, bar, sl, tp, exitMode);
      if (resolved !== null) {
        const { exitPrice: grossExitPrice, reason } = resolved;
        const halfCost = executionModel === 'bar_l2_v1'
          ? halfAdverseExecutionCostDistance(
              pipSize,
              roundTripCostPips,
              roundTripCostAtrMult,
              table,
              entryIndex,
            )
          : 0;
        const exitPrice = adjustExitPrice(side, grossExitPrice, halfCost);
        const rawPnl = calculatePnl(side, grossEntryPrice, grossExitPrice, lotSize);
        const pnl = executionModel === 'bar_l2_v1'
          ? calculatePnl(side, entryPrice, exitPrice, lotSize)
          : applyTransactionCosts(
              rawPnl,
              pipSize,
              lotSize,
              roundTripCostPips,
              roundTripCostAtrMult,
              table,
              entryIndex,
            );
        const transactionCost = rawPnl - pnl;
        totalCost += transactionCost;
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
          indicatorValues: {
            grossPnl: rawPnl,
            transactionCost,
          },
        });
        position = null;
        if (isWait) {
          waitStart = null;
          waitAborted = false;
        }
      }
    }

    if (!position && isWait) {
      if (waitAborted) {
        prevSnap = snap;
        continue;
      }
      const wEntry = dsl.entry;
      if (!isWaitForTriggerEntry(wEntry)) {
        break;
      }
      if (waitStart === null) {
        waitStart = i;
      }
      if (i - waitStart > wEntry.maxWaitBars) {
        waitAborted = true;
        prevSnap = snap;
        continue;
      }
      const condOk = evaluator.evaluateConditions(
        wEntry.triggerConditions,
        snap,
        paramValues,
        prevSnap,
      );
      if (condOk && i + 1 < bars.length) {
        const j = i + 1;
        const openPx = bars[j].open;
        const slIx = j;
        const stopDist = stopDistance(dsl, table, slIx, pipSize, paramValues, evaluator);
        const tpDist = takeProfitDistance(dsl, stopDist, table, slIx, pipSize, paramValues, evaluator);
        if (wEntry.direction === 'long') {
          const halfCost = executionModel === 'bar_l2_v1'
            ? halfAdverseExecutionCostDistance(
                pipSize,
                roundTripCostPips,
                roundTripCostAtrMult,
                table,
                j,
              )
            : 0;
          position = {
            side: 'buy',
            entryIndex: j,
            entryPrice: adjustEntryPrice('buy', openPx, halfCost),
            grossEntryPrice: openPx,
            sl: openPx - stopDist,
            tp: openPx + tpDist,
          };
        } else {
          const halfCost = executionModel === 'bar_l2_v1'
            ? halfAdverseExecutionCostDistance(
                pipSize,
                roundTripCostPips,
                roundTripCostAtrMult,
                table,
                j,
              )
            : 0;
          position = {
            side: 'sell',
            entryIndex: j,
            entryPrice: adjustEntryPrice('sell', openPx, halfCost),
            grossEntryPrice: openPx,
            sl: openPx + stopDist,
            tp: openPx - tpDist,
          };
        }
        waitStart = null;
      }
    } else if (!position && i < bars.length - 1) {
      const e = dsl.entry;
      if (!('trigger' in e)) {
        break;
      }
      const entryOk = evaluator.evaluateConditions(e.trigger, snap, paramValues, prevSnap);
      if (entryOk) {
        if (immediateFill === 'next_bar_open' && i + 1 < bars.length) {
          deferredImmediate = { openAtIndex: i + 1, isLong: e.direction === 'long' };
        } else {
          const closePx = bars[i].close;
          const stopDist = stopDistance(dsl, table, i, pipSize, paramValues, evaluator);
          const tpDist = takeProfitDistance(dsl, stopDist, table, i, pipSize, paramValues, evaluator);
          if (e.direction === 'long') {
            const halfCost = executionModel === 'bar_l2_v1'
              ? halfAdverseExecutionCostDistance(
                  pipSize,
                  roundTripCostPips,
                  roundTripCostAtrMult,
                  table,
                  i,
                )
              : 0;
            position = {
              side: 'buy',
              entryIndex: i,
              entryPrice: adjustEntryPrice('buy', closePx, halfCost),
              grossEntryPrice: closePx,
              sl: closePx - stopDist,
              tp: closePx + tpDist,
            };
          } else {
            const halfCost = executionModel === 'bar_l2_v1'
              ? halfAdverseExecutionCostDistance(
                  pipSize,
                  roundTripCostPips,
                  roundTripCostAtrMult,
                  table,
                  i,
                )
              : 0;
            position = {
              side: 'sell',
              entryIndex: i,
              entryPrice: adjustEntryPrice('sell', closePx, halfCost),
              grossEntryPrice: closePx,
              sl: closePx + stopDist,
              tp: closePx - tpDist,
            };
          }
        }
      }
    }

    // PR ①-B: 次イテで使う前バー snapshot を保存。break で抜けた場合は不要 (= ループ離脱)、
    // continue 経路では各 continue の直前で prevSnap を更新済み (= 抜け漏れ防止)。
    prevSnap = snap;
  }

  const summary = calculateSummary(events, initialCapital);
  const costSummary: ExecutionCostSummary = {
    model: executionModel,
    dataSource: executionDataSource,
    roundTripCostPips: Math.max(0, roundTripCostPips ?? 0),
    roundTripCostAtrMult: Math.max(0, roundTripCostAtrMult ?? 0),
    totalCost,
  };
  return {
    summary,
    trades: events,
    execution: {
      executionModel,
      executionConfigHash,
      dataSource: executionDataSource,
      costSummary,
    },
  };
}
