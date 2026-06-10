/**
 * ノート類似度基盤 — インジケーターレンズ(新設)
 *
 * 正本設計: docs/architecture/NOTE_SIMILARITY_FOUNDATION.md §5
 *
 * 責務:
 * - `IndicatorProfile` の設定(IndicatorConfig 互換)から「どのインジケーターレンズを
 *   どのパラメータで有効化するか」を決定論的に解決する(§5.3)
 * - analysis-engine `/v1/indicator-series` で得た値系列から、トレード的に意味のある
 *   **正規化済みの状態 + イベント特徴**を純粋関数で計算する(§5.1〜§5.2)
 *
 * コアセット(§5.4 確定): rsi / macd / ma(SMA・EMA、複数本のクロス含む) / bb。
 * 他指標は同じ枠組みで加算的に追加する。
 *
 * 実装規約(Side-B ドメイン原則 §4 準拠):
 * - 副作用なし・他レンズ非依存・決定性あり(同一入力 → 同一出力)
 * - 値の計算自体は analysis-engine が正(ここでは再計算しない。§2-⑦)
 */

import type { LensSnapshotEntry } from './lensSnapshotTypes';

/** インジケーターレンズ実装のバージョン(挙動変更時に上げる) */
export const INDICATOR_LENS_VERSION = '1.0.0';

/** lensId の系統接頭辞。`ind:` で始まる lensId はインジケーターレンズ */
export const INDICATOR_LENS_PREFIX = 'ind:';

/** クロス検出の遡り上限(これより古いクロスは bars_since の sentinel 扱い) */
export const CROSS_SEARCH_LOOKBACK_BARS = 20;

/** 「直近クロスイベントあり」と判定する窓(これ以内のクロスを cross=bull/bear とする) */
export const CROSS_EVENT_WINDOW_BARS = 5;

/** ダイバージェンス検出の遡り窓 */
export const DIVERGENCE_LOOKBACK_BARS = 30;

/** confidence=1 とみなすのに十分な有効バー数 */
export const DESIRED_VALID_BARS = 30;

/** 傾き計算の遡りバー数 */
const SLOPE_LOOKBACK_BARS = 5;

/** 傾き正規化スケール(SLOPE_LOOKBACK_BARS 間の相対変化率がこの値で tanh≈0.76 になる) */
const SLOPE_NORMALIZE_SCALE = 0.002;

/** 価格と MA の乖離正規化スケール(相対乖離率) */
const MA_DISTANCE_NORMALIZE_SCALE = 0.005;

/** BB 相対バンド幅をこの値で 1.0 に飽和させる(既存 featureVectorService と同じ 5%) */
const BB_WIDTH_SATURATION = 0.05;

/** 「直近イベントなし」を表す sentinel(設計書 §4 の慣行に合わせる) */
export const BARS_SINCE_SENTINEL = -1;

/** インジケーターレンズの種別 */
export type IndicatorLensKind = 'rsi' | 'macd' | 'ma' | 'ma_cross' | 'bb';

/** クロス・ダイバージェンス等の方向イベント値 */
export type DirectionalEventValue = 'bull' | 'none' | 'bear';

/** ゾーン区分(過熱度) */
export type OscillatorZoneValue = 'oversold' | 'neutral' | 'overbought';

/**
 * IndicatorProfile から渡される 1 インジケーター設定の構造的サブセット。
 * Side-A の `IndicatorConfig`(src/models/indicatorConfig.ts)が構造的に代入可能。
 * shared → models の依存を作らないため必要フィールドのみ structural に受ける。
 */
export interface IndicatorLensSourceConfig {
  readonly indicatorId: string;
  readonly params: {
    readonly period?: number;
    readonly fastPeriod?: number;
    readonly slowPeriod?: number;
    readonly signalPeriod?: number;
  };
  readonly enabled?: boolean;
}

/**
 * analysis-engine `/v1/indicator-series` への 1 系列リクエスト仕様。
 * `seriesKey` は IndicatorLensComputeInput.series のキーとして使う内部識別子。
 */
export interface IndicatorSeriesRequest {
  /** 内部識別子(レンズ入力 series のキー) */
  readonly seriesKey: string;
  /** analysis-engine の indicatorId(rsi / macd / sma / ema / bb) */
  readonly indicatorId: string;
  /** analysis-engine に渡すパラメータ */
  readonly params: Readonly<Record<string, number>>;
  /** analysis-engine の field(value / signal / histogram / upper / lower) */
  readonly field: string;
}

/** MA 1 本の解決済み仕様(ma / ma_cross の meta) */
export interface ResolvedMaSpec {
  readonly maType: 'sma' | 'ema';
  readonly period: number;
}

/**
 * 解決済みインジケーターレンズ仕様。
 * lensId は params を含む決定論的 ID(例: `ind:rsi#p14`, `ind:ma#ema20`,
 * `ind:ma_cross#ema20xsma75`)。同じ Profile からは常に同じ集合が得られ、
 * ノート側と市場側で lensId が一致することで次元不一致を原理的に消す(§5.3)。
 */
export interface IndicatorLensSpec {
  readonly lensId: string;
  readonly kind: IndicatorLensKind;
  readonly lensVersion: string;
  /** このレンズの計算に必要な analysis-engine 系列 */
  readonly requiredSeries: ReadonlyArray<IndicatorSeriesRequest>;
  /** ma / ma_cross の追加情報(表示・デバッグ用) */
  readonly maSpecs?: ReadonlyArray<ResolvedMaSpec>;
}

/**
 * インジケーターレンズ計算への入力。
 * - close: 終値系列(古い → 新しい。最終要素が評価時点)
 * - series: seriesKey → 指標値系列(close と同じ並び・同じ長さ。欠損は null)
 */
export interface IndicatorLensComputeInput {
  readonly close: ReadonlyArray<number>;
  readonly series: Readonly<Record<string, ReadonlyArray<number | null>>>;
}

// ============================================================
// Profile → レンズ仕様の解決(§5.3)
// ============================================================

/**
 * IndicatorProfile の設定配列からインジケーターレンズ仕様を解決する。
 *
 * - enabled=false の設定は無視
 * - コアセット外の indicatorId は無視(加算的拡張で対応。エラーにしない)
 * - 同一 lensId は重複排除
 * - MA が 2 本以上ある場合、期間昇順で隣接ペアの ma_cross レンズを自動生成する
 *   (設計書 §5.4「短×中、中×長 等の GC/DC」)
 */
export function resolveIndicatorLensSpecs(
  configs: ReadonlyArray<IndicatorLensSourceConfig>
): IndicatorLensSpec[] {
  const specs = new Map<string, IndicatorLensSpec>();
  const maSpecs: ResolvedMaSpec[] = [];

  for (const config of configs) {
    if (config.enabled === false) {
      continue;
    }
    switch (config.indicatorId) {
      case 'rsi': {
        const period = normalizePeriod(config.params.period, 14);
        const lensId = `${INDICATOR_LENS_PREFIX}rsi#p${period}`;
        specs.set(lensId, {
          lensId,
          kind: 'rsi',
          lensVersion: INDICATOR_LENS_VERSION,
          requiredSeries: [
            { seriesKey: 'rsi', indicatorId: 'rsi', params: { period }, field: 'value' },
          ],
        });
        break;
      }
      case 'macd': {
        const fast = normalizePeriod(config.params.fastPeriod, 12);
        const slow = normalizePeriod(config.params.slowPeriod, 26);
        const signal = normalizePeriod(config.params.signalPeriod, 9);
        const params = { fastPeriod: fast, slowPeriod: slow, signalPeriod: signal };
        const lensId = `${INDICATOR_LENS_PREFIX}macd#f${fast}s${slow}g${signal}`;
        specs.set(lensId, {
          lensId,
          kind: 'macd',
          lensVersion: INDICATOR_LENS_VERSION,
          requiredSeries: [
            { seriesKey: 'macd', indicatorId: 'macd', params, field: 'value' },
            { seriesKey: 'signal', indicatorId: 'macd', params, field: 'signal' },
            { seriesKey: 'histogram', indicatorId: 'macd', params, field: 'histogram' },
          ],
        });
        break;
      }
      case 'sma':
      case 'ema': {
        const period = normalizePeriod(config.params.period, 20);
        const maType = config.indicatorId;
        const lensId = `${INDICATOR_LENS_PREFIX}ma#${maType}${period}`;
        if (!specs.has(lensId)) {
          maSpecs.push({ maType, period });
        }
        specs.set(lensId, {
          lensId,
          kind: 'ma',
          lensVersion: INDICATOR_LENS_VERSION,
          requiredSeries: [
            { seriesKey: 'ma', indicatorId: maType, params: { period }, field: 'value' },
          ],
          maSpecs: [{ maType, period }],
        });
        break;
      }
      case 'bb': {
        const period = normalizePeriod(config.params.period, 20);
        const lensId = `${INDICATOR_LENS_PREFIX}bb#p${period}`;
        specs.set(lensId, {
          lensId,
          kind: 'bb',
          lensVersion: INDICATOR_LENS_VERSION,
          requiredSeries: [
            { seriesKey: 'upper', indicatorId: 'bb', params: { period }, field: 'upper' },
            { seriesKey: 'middle', indicatorId: 'bb', params: { period }, field: 'value' },
            { seriesKey: 'lower', indicatorId: 'bb', params: { period }, field: 'lower' },
          ],
        });
        break;
      }
      default:
        // コアセット(§5.4)外はこの段階では対象外。加算的に追加していく
        break;
    }
  }

  // 複数 MA の隣接ペアからクロスレンズを生成(期間昇順、同期間は type 名順)
  const sortedMa = [...dedupeMaSpecs(maSpecs)].sort(
    (a, b) => a.period - b.period || a.maType.localeCompare(b.maType)
  );
  for (let i = 0; i + 1 < sortedMa.length; i += 1) {
    const fastMa = sortedMa[i];
    const slowMa = sortedMa[i + 1];
    const lensId =
      `${INDICATOR_LENS_PREFIX}ma_cross#` +
      `${fastMa.maType}${fastMa.period}x${slowMa.maType}${slowMa.period}`;
    specs.set(lensId, {
      lensId,
      kind: 'ma_cross',
      lensVersion: INDICATOR_LENS_VERSION,
      requiredSeries: [
        {
          seriesKey: 'fast',
          indicatorId: fastMa.maType,
          params: { period: fastMa.period },
          field: 'value',
        },
        {
          seriesKey: 'slow',
          indicatorId: slowMa.maType,
          params: { period: slowMa.period },
          field: 'value',
        },
      ],
      maSpecs: [fastMa, slowMa],
    });
  }

  return [...specs.values()];
}

/** 期間パラメータの正規化(未指定・不正値は既定値、整数化) */
function normalizePeriod(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) {
    return fallback;
  }
  return Math.round(value);
}

/** MA 仕様の重複排除(同 type × 同 period を 1 本に) */
function dedupeMaSpecs(specs: ReadonlyArray<ResolvedMaSpec>): ResolvedMaSpec[] {
  const seen = new Set<string>();
  const result: ResolvedMaSpec[] = [];
  for (const spec of specs) {
    const key = `${spec.maType}${spec.period}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(spec);
    }
  }
  return result;
}

// ============================================================
// レンズ計算(純粋関数)
// ============================================================

/**
 * インジケーターレンズ 1 つ分の特徴を計算する。
 *
 * 決定性: 同一の spec + input からは常に同一の出力を返す。
 * 欠損耐性: 必要系列が欠けている・有効データが浅い場合は confidence を下げ、
 * 計算不能なら confidence=0 / features={} を返す(全体を壊さない。§2-⑤)。
 */
export function computeIndicatorLens(
  spec: IndicatorLensSpec,
  input: IndicatorLensComputeInput
): LensSnapshotEntry {
  switch (spec.kind) {
    case 'rsi':
      return computeRsiLens(input);
    case 'macd':
      return computeMacdLens(input);
    case 'ma':
      return computeMaLens(input);
    case 'ma_cross':
      return computeMaCrossLens(input);
    case 'bb':
      return computeBbLens(input);
  }
}

/** 計算不能時の空エントリ */
function emptyEntry(): LensSnapshotEntry {
  return { lensVersion: INDICATOR_LENS_VERSION, confidence: 0, features: {} };
}

/** `ind:rsi` — rsi_zone / rsi_value / rsi_divergence (§5.4) */
function computeRsiLens(input: IndicatorLensComputeInput): LensSnapshotEntry {
  const rsi = input.series['rsi'];
  if (!rsi) {
    return emptyEntry();
  }
  const latest = lastValidValue(rsi);
  if (latest === null) {
    return emptyEntry();
  }
  const zone: OscillatorZoneValue =
    latest <= 30 ? 'oversold' : latest >= 70 ? 'overbought' : 'neutral';
  const divergence = detectDivergence(input.close, rsi);
  return {
    lensVersion: INDICATOR_LENS_VERSION,
    confidence: dataDepthConfidence([rsi], input.close),
    features: {
      rsi_zone: zone,
      rsi_value: clamp(latest / 100, 0, 1),
      rsi_divergence: divergence,
    },
  };
}

/** `ind:macd` — macd_cross / macd_bars_since_cross / macd_hist_slope / macd_divergence (§5.4) */
function computeMacdLens(input: IndicatorLensComputeInput): LensSnapshotEntry {
  const macd = input.series['macd'];
  const signal = input.series['signal'];
  const histogram = input.series['histogram'];
  if (!macd || !signal || !histogram) {
    return emptyEntry();
  }
  if (lastValidValue(macd) === null || lastValidValue(signal) === null) {
    return emptyEntry();
  }
  const cross = detectRecentCross(macd, signal);
  const histSlope = normalizedSlope(histogram, computeSlopeScale(input.close));
  const divergence = detectDivergence(input.close, macd);
  return {
    lensVersion: INDICATOR_LENS_VERSION,
    confidence: dataDepthConfidence([macd, signal, histogram], input.close),
    features: {
      macd_cross: cross.event,
      macd_bars_since_cross: cross.barsSince,
      macd_hist_slope: histSlope,
      macd_divergence: divergence,
    },
  };
}

/** `ind:ma` — ma_slope / ma_distance_norm (§5.4) */
function computeMaLens(input: IndicatorLensComputeInput): LensSnapshotEntry {
  const ma = input.series['ma'];
  if (!ma) {
    return emptyEntry();
  }
  const latestMa = lastValidValue(ma);
  const latestClose = lastValue(input.close);
  if (latestMa === null || latestMa === 0 || latestClose === null) {
    return emptyEntry();
  }
  // 相対乖離率を tanh で [-1,1] に正規化(シンボル間の絶対価格差を消す)
  const distanceNorm = Math.tanh((latestClose - latestMa) / latestMa / MA_DISTANCE_NORMALIZE_SCALE);
  return {
    lensVersion: INDICATOR_LENS_VERSION,
    confidence: dataDepthConfidence([ma], input.close),
    features: {
      ma_slope: relativeSlope(ma),
      ma_distance_norm: distanceNorm,
    },
  };
}

/** `ind:ma_cross` — ma_cross / ma_bars_since_cross / ma_fast_above_slow (§5.4 GC/DC) */
function computeMaCrossLens(input: IndicatorLensComputeInput): LensSnapshotEntry {
  const fast = input.series['fast'];
  const slow = input.series['slow'];
  if (!fast || !slow) {
    return emptyEntry();
  }
  const latestFast = lastValidValue(fast);
  const latestSlow = lastValidValue(slow);
  if (latestFast === null || latestSlow === null) {
    return emptyEntry();
  }
  const cross = detectRecentCross(fast, slow);
  return {
    lensVersion: INDICATOR_LENS_VERSION,
    confidence: dataDepthConfidence([fast, slow], input.close),
    features: {
      ma_cross: cross.event,
      ma_bars_since_cross: cross.barsSince,
      ma_fast_above_slow: latestFast > latestSlow,
    },
  };
}

/** `ind:bb` — bb_position / bb_width_norm (§5.4) */
function computeBbLens(input: IndicatorLensComputeInput): LensSnapshotEntry {
  const upper = input.series['upper'];
  const middle = input.series['middle'];
  const lower = input.series['lower'];
  if (!upper || !middle || !lower) {
    return emptyEntry();
  }
  const latestUpper = lastValidValue(upper);
  const latestMiddle = lastValidValue(middle);
  const latestLower = lastValidValue(lower);
  const latestClose = lastValue(input.close);
  if (
    latestUpper === null ||
    latestMiddle === null ||
    latestLower === null ||
    latestClose === null ||
    latestMiddle === 0
  ) {
    return emptyEntry();
  }
  const width = latestUpper - latestLower;
  // バンド幅ゼロ(完全フラット)は位置が定義できないため中央 0.5 とする
  const position = width > 0 ? clamp((latestClose - latestLower) / width, 0, 1) : 0.5;
  const widthNorm = clamp(width / Math.abs(latestMiddle) / BB_WIDTH_SATURATION, 0, 1);
  return {
    lensVersion: INDICATOR_LENS_VERSION,
    confidence: dataDepthConfidence([upper, middle, lower], input.close),
    features: {
      bb_position: position,
      bb_width_norm: widthNorm,
    },
  };
}

// ============================================================
// 内部ヘルパ(全て純粋関数)
// ============================================================

/** 末尾の有効値(非 null・有限)を返す。無ければ null */
function lastValidValue(series: ReadonlyArray<number | null>): number | null {
  for (let i = series.length - 1; i >= 0; i -= 1) {
    const value = series[i];
    if (value !== null && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

/** number 配列の末尾値(有限値のみ)。無ければ null */
function lastValue(series: ReadonlyArray<number>): number | null {
  for (let i = series.length - 1; i >= 0; i -= 1) {
    const value = series[i];
    if (Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

/** [min,max] に丸める */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * データ深度ベースの confidence。
 * 必要系列それぞれの「末尾からの連続有効バー数」の最小値を DESIRED_VALID_BARS で
 * 割って [0,1] にする。深いデータほど 1 に近づく(決定論的)。
 */
function dataDepthConfidence(
  seriesList: ReadonlyArray<ReadonlyArray<number | null>>,
  close: ReadonlyArray<number>
): number {
  let minDepth = trailingValidCount(close.map((v) => (Number.isFinite(v) ? v : null)));
  for (const series of seriesList) {
    minDepth = Math.min(minDepth, trailingValidCount(series));
  }
  return clamp(minDepth / DESIRED_VALID_BARS, 0, 1);
}

/** 末尾から連続する有効値の数 */
function trailingValidCount(series: ReadonlyArray<number | null>): number {
  let count = 0;
  for (let i = series.length - 1; i >= 0; i -= 1) {
    const value = series[i];
    if (value === null || !Number.isFinite(value)) {
      break;
    }
    count += 1;
  }
  return count;
}

/**
 * 直近クロスの検出。
 * - event: 直近 CROSS_EVENT_WINDOW_BARS 以内に発生したクロスの方向(無ければ none)
 * - barsSince: 最後のクロスからの経過バー数(CROSS_SEARCH_LOOKBACK_BARS 以内に
 *   見つからなければ BARS_SINCE_SENTINEL)
 */
function detectRecentCross(
  lineA: ReadonlyArray<number | null>,
  lineB: ReadonlyArray<number | null>
): { event: DirectionalEventValue; barsSince: number } {
  const length = Math.min(lineA.length, lineB.length);
  // diff[t] = A - B の符号列を末尾から遡り、符号反転点を探す
  let barsSince = BARS_SINCE_SENTINEL;
  let direction: DirectionalEventValue = 'none';
  let previousSign: number | null = null;
  let stepsBack = 0;
  // 検出時の barsSince は stepsBack - 1 になるため、「ちょうど LOOKBACK 本前」の
  // クロス(barsSince = LOOKBACK)まで拾えるよう探索は +1 本ぶん広げる
  for (let i = length - 1; i >= 0 && stepsBack <= CROSS_SEARCH_LOOKBACK_BARS + 1; i -= 1) {
    const a = lineA[i];
    const b = lineB[i];
    if (a === null || b === null || !Number.isFinite(a) || !Number.isFinite(b)) {
      break;
    }
    const sign = Math.sign(a - b);
    if (previousSign !== null && sign !== 0 && sign !== previousSign) {
      // i+1 時点(previousSign 側)が新しい側 → クロスは i→i+1 で発生
      barsSince = stepsBack - 1;
      direction = previousSign > 0 ? 'bull' : 'bear';
      break;
    }
    if (sign !== 0) {
      previousSign = sign;
    }
    stepsBack += 1;
  }
  const event: DirectionalEventValue =
    barsSince !== BARS_SINCE_SENTINEL && barsSince <= CROSS_EVENT_WINDOW_BARS
      ? direction
      : 'none';
  return { event, barsSince };
}

/** 系列の相対傾き(SLOPE_LOOKBACK_BARS 遡りの変化率)を tanh で [-1,1] に正規化 */
function relativeSlope(series: ReadonlyArray<number | null>): number {
  const points = collectTrailingValid(series, SLOPE_LOOKBACK_BARS + 1);
  if (points.length < 2) {
    return 0;
  }
  const first = points[0];
  const last = points[points.length - 1];
  if (first === 0) {
    return 0;
  }
  const changeRate = (last - first) / Math.abs(first) / (points.length - 1);
  return Math.tanh(changeRate / SLOPE_NORMALIZE_SCALE);
}

/**
 * ヒストグラム等の「価格スケールに比例する系列」の傾きを価格基準で正規化する。
 * 系列自体が 0 をまたぐ(相対化の分母にできない)ため、終値スケールを分母に使う。
 */
function normalizedSlope(series: ReadonlyArray<number | null>, priceScale: number): number {
  const points = collectTrailingValid(series, SLOPE_LOOKBACK_BARS + 1);
  if (points.length < 2 || priceScale <= 0) {
    return 0;
  }
  const first = points[0];
  const last = points[points.length - 1];
  const changeRate = (last - first) / priceScale / (points.length - 1);
  return Math.tanh(changeRate / (SLOPE_NORMALIZE_SCALE * 0.1));
}

/** 終値ベースの価格スケール(末尾値の絶対値) */
function computeSlopeScale(close: ReadonlyArray<number>): number {
  const latest = lastValue(close);
  return latest === null ? 0 : Math.abs(latest);
}

/** 末尾から最大 n 個の連続有効値を「古い → 新しい」順で返す */
function collectTrailingValid(series: ReadonlyArray<number | null>, n: number): number[] {
  const collected: number[] = [];
  for (let i = series.length - 1; i >= 0 && collected.length < n; i -= 1) {
    const value = series[i];
    if (value === null || !Number.isFinite(value)) {
      break;
    }
    collected.push(value);
  }
  return collected.reverse();
}

/**
 * ダイバージェンス検出(決定論的・簡易版)。
 *
 * 直近 DIVERGENCE_LOOKBACK_BARS 内の価格ピボットを検出し、直近 2 つの
 * ピボット高値で「価格は切り上げ・オシレーターは切り下げ」なら bear、
 * 直近 2 つのピボット安値で「価格は切り下げ・オシレーターは切り上げ」なら bull。
 * 両方検出された場合はより新しいピボット対を採用する。
 */
export function detectDivergence(
  close: ReadonlyArray<number>,
  oscillator: ReadonlyArray<number | null>
): DirectionalEventValue {
  const length = Math.min(close.length, oscillator.length);
  if (length < 10) {
    return 'none';
  }
  const start = Math.max(0, length - DIVERGENCE_LOOKBACK_BARS);
  const pivotHighs: number[] = [];
  const pivotLows: number[] = [];
  // ピボット: 前後 2 本より高い(安い)バー。決定性のため同値は許容しない
  for (let i = start + 2; i < length - 2; i += 1) {
    const c = close[i];
    if (!Number.isFinite(c)) {
      continue;
    }
    if (c > close[i - 1] && c > close[i - 2] && c > close[i + 1] && c > close[i + 2]) {
      pivotHighs.push(i);
    }
    if (c < close[i - 1] && c < close[i - 2] && c < close[i + 1] && c < close[i + 2]) {
      pivotLows.push(i);
    }
  }

  const bearAt = divergenceAtPivots(pivotHighs, close, oscillator, 'bear');
  const bullAt = divergenceAtPivots(pivotLows, close, oscillator, 'bull');
  if (bearAt === null && bullAt === null) {
    return 'none';
  }
  if (bearAt !== null && (bullAt === null || bearAt > bullAt)) {
    return 'bear';
  }
  return 'bull';
}

/**
 * ピボット列の直近 2 点でダイバージェンスが成立するか判定し、
 * 成立時は新しい側のピボット index を返す(優先度判定用)。
 */
function divergenceAtPivots(
  pivots: ReadonlyArray<number>,
  close: ReadonlyArray<number>,
  oscillator: ReadonlyArray<number | null>,
  kind: 'bull' | 'bear'
): number | null {
  if (pivots.length < 2) {
    return null;
  }
  const older = pivots[pivots.length - 2];
  const newer = pivots[pivots.length - 1];
  const oscOlder = oscillator[older];
  const oscNewer = oscillator[newer];
  if (
    oscOlder === null ||
    oscNewer === null ||
    !Number.isFinite(oscOlder) ||
    !Number.isFinite(oscNewer)
  ) {
    return null;
  }
  if (kind === 'bear') {
    // 価格は高値切り上げ、オシレーターは切り下げ
    if (close[newer] > close[older] && oscNewer < oscOlder) {
      return newer;
    }
    return null;
  }
  // 価格は安値切り下げ、オシレーターは切り上げ
  if (close[newer] < close[older] && oscNewer > oscOlder) {
    return newer;
  }
  return null;
}
