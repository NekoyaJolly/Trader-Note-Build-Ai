/**
 * ローソク足パターン判定の共通実装 (Side-A / Side-B 共有)。
 *
 * 設計方針:
 * - **真実は Python `analysis-engine/app/indicators.py` の `compute_pinbar_flags`
 *   / `compute_candlestick_pattern_flags`**。本 TS 実装は Python と **同じ式** で
 *   動くことをユニットテストで保証する port。
 * - 用途: Side-B `PatternLens` (進化ループで何百回呼ばれる surrogate 用に
 *   ローカル計算が必須) / Side-A 表示用キャッシュ。本格 BT (= Side-A の最終
 *   評価) は analysis-engine が引き続き真実。
 * - 全関数は **pure / 決定論的 / 副作用なし**。レンズ実装規約 (CLAUDE.md
 *   原則 4) と同じ。
 *
 * 提供パターン (12 種):
 *   pinbar / pinbar_bull / pinbar_bear / hammer / hammer_bull / hammer_bear /
 *   shooting_star / engulfing_bull / engulfing_bear / doji / thrust_bull /
 *   thrust_bear
 *
 * @see analysis-engine/app/indicators.py compute_pinbar_flags
 * @see analysis-engine/app/indicators.py compute_candlestick_pattern_flags
 */

/** 1 バー分の OHLC (volume は本 lib では使わない)。 */
export interface PatternBar {
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
}

export type CandlePatternId =
  | 'pinbar'
  | 'pinbar_bull'
  | 'pinbar_bear'
  | 'hammer'
  | 'hammer_bull'
  | 'hammer_bear'
  | 'shooting_star'
  | 'engulfing_bull'
  | 'engulfing_bear'
  | 'doji'
  | 'thrust_bull'
  | 'thrust_bear';

export const ALL_CANDLE_PATTERN_IDS: readonly CandlePatternId[] = [
  'pinbar',
  'pinbar_bull',
  'pinbar_bear',
  'hammer',
  'hammer_bull',
  'hammer_bear',
  'shooting_star',
  'engulfing_bull',
  'engulfing_bear',
  'doji',
  'thrust_bull',
  'thrust_bear',
];

/**
 * Python `compute_pinbar_flags` と同じ式でピンバー系を判定する。
 *
 * 定義 (Python と同期):
 * - 実体 = |close - open|
 * - 上ヒゲ = high - max(open, close)
 * - 下ヒゲ = min(open, close) - low
 * - 実体 0 は除外 (ノイズ)
 * - bull: 下ヒゲ >= 3 * 実体 かつ 上ヒゲ <= 0.5 * 実体 (下に長いヒゲ)
 * - bear: 上ヒゲ >= 3 * 実体 かつ 下ヒゲ <= 0.5 * 実体 (上に長いヒゲ)
 * - pinbar = bull | bear
 */
export function computePinbarFlags(
  bars: readonly PatternBar[],
): { pinbar: boolean[]; pinbar_bull: boolean[]; pinbar_bear: boolean[] } {
  const n = bars.length;
  const pinbar = new Array<boolean>(n).fill(false);
  const pinbar_bull = new Array<boolean>(n).fill(false);
  const pinbar_bear = new Array<boolean>(n).fill(false);

  for (let i = 0; i < n; i++) {
    const b = bars[i];
    const body = Math.abs(b.close - b.open);
    if (!(body > 0)) continue;
    const upper = b.high - Math.max(b.open, b.close);
    const lower = Math.min(b.open, b.close) - b.low;
    const bull = lower >= 3.0 * body && upper <= 0.5 * body;
    const bear = upper >= 3.0 * body && lower <= 0.5 * body;
    pinbar_bull[i] = bull;
    pinbar_bear[i] = bear;
    pinbar[i] = bull || bear;
  }
  return { pinbar, pinbar_bull, pinbar_bear };
}

/**
 * Python `compute_candlestick_pattern_flags` と同じ式で 12 系列のうち
 * 9 系列 (pinbar 以外) を判定する。
 *
 * 定義 (Python と同期):
 * - 実体 = |close - open|
 * - レンジ = max(high - low, 0)
 * - 上ヒゲ = high - max(open, close)
 * - 下ヒゲ = min(open, close) - low
 * - レンジ 0 は除外
 * - hammer: 下ヒゲ >= 2 * 実体 かつ 上ヒゲ <= 0.5 * 実体
 * - shooting_star: 上ヒゲ >= 2 * 実体 かつ 下ヒゲ <= 0.5 * 実体
 * - doji: 実体 <= 0.1 * レンジ
 * - thrust: 実体 >= 0.7 * レンジ
 * - engulfing: 前バー実体を現バー実体が包む (先頭バーは無効)
 *
 * 注: Python 側は同関数内で `pinbar_like` (3:0.5 比率) も計算するが、
 * 戻り値には含まない。本 TS 実装も pinbar 系は別関数 (`computePinbarFlags`) で
 * 提供し、ここからは **意図的に省く** (Python の戻り値構造に揃える)。
 */
export function computeCandlestickPatternFlags(
  bars: readonly PatternBar[],
): {
  hammer: boolean[];
  hammer_bull: boolean[];
  hammer_bear: boolean[];
  shooting_star: boolean[];
  engulfing_bull: boolean[];
  engulfing_bear: boolean[];
  doji: boolean[];
  thrust_bull: boolean[];
  thrust_bear: boolean[];
} {
  const n = bars.length;
  const hammer = new Array<boolean>(n).fill(false);
  const hammer_bull = new Array<boolean>(n).fill(false);
  const hammer_bear = new Array<boolean>(n).fill(false);
  const shooting_star = new Array<boolean>(n).fill(false);
  const engulfing_bull = new Array<boolean>(n).fill(false);
  const engulfing_bear = new Array<boolean>(n).fill(false);
  const doji = new Array<boolean>(n).fill(false);
  const thrust_bull = new Array<boolean>(n).fill(false);
  const thrust_bear = new Array<boolean>(n).fill(false);

  for (let i = 0; i < n; i++) {
    const b = bars[i];
    const body = Math.abs(b.close - b.open);
    const rng = Math.max(b.high - b.low, 0.0);
    const upper = b.high - Math.max(b.open, b.close);
    const lower = Math.min(b.open, b.close) - b.low;

    if (rng > 0) {
      const isHammer = lower >= 2.0 * body && upper <= 0.5 * body;
      hammer[i] = isHammer;
      hammer_bull[i] = isHammer && b.close > b.open;
      hammer_bear[i] = isHammer && b.close < b.open;

      shooting_star[i] = upper >= 2.0 * body && lower <= 0.5 * body;
      doji[i] = body <= 0.1 * rng;

      const isThrust = body >= 0.7 * rng;
      thrust_bull[i] = isThrust && b.close > b.open;
      thrust_bear[i] = isThrust && b.close < b.open;
    }

    if (i > 0) {
      const prev = bars[i - 1];
      const prevBear = prev.close < prev.open;
      const prevBull = prev.close > prev.open;
      const currBull = b.close > b.open;
      const currBear = b.close < b.open;
      engulfing_bull[i] =
        prevBear && currBull && b.open <= prev.close && b.close >= prev.open;
      engulfing_bear[i] =
        prevBull && currBear && b.open >= prev.close && b.close <= prev.open;
    }
  }

  return {
    hammer,
    hammer_bull,
    hammer_bear,
    shooting_star,
    engulfing_bull,
    engulfing_bear,
    doji,
    thrust_bull,
    thrust_bear,
  };
}

/**
 * 12 種の pattern flag をまとめて計算する。
 *
 * 戻り値は `Record<CandlePatternId, boolean[]>` 形式で、各配列の長さは
 * `bars.length` と一致する。`PatternLens` / surrogate snapshot 構築側は
 * バー index で各 patternId の真偽を引ける。
 */
export function computeAllPatternFlags(
  bars: readonly PatternBar[],
): Record<CandlePatternId, boolean[]> {
  const pin = computePinbarFlags(bars);
  const rest = computeCandlestickPatternFlags(bars);
  return {
    pinbar: pin.pinbar,
    pinbar_bull: pin.pinbar_bull,
    pinbar_bear: pin.pinbar_bear,
    ...rest,
  };
}

/**
 * 指定バー位置 (= index) における全 pattern の真偽を 1 オブジェクトで返す。
 *
 * `PatternLens.compute` で snapshot に詰める形式。i=0 の engulfing は前バー
 * 不在のため必ず false (Python 側 `valid_prev` と同じ挙動)。
 */
export function patternFlagsAtIndex(
  bars: readonly PatternBar[],
  index: number,
): Record<CandlePatternId, boolean> {
  if (index < 0 || index >= bars.length) {
    const empty = {} as Record<CandlePatternId, boolean>;
    for (const id of ALL_CANDLE_PATTERN_IDS) empty[id] = false;
    return empty;
  }
  // パフォーマンス上ここでは all を計算してから index を引く形にしない。
  // 1 バー単位の計算は engulfing が前バー依存だが、bars[index-1] と
  // bars[index] のみで判定できるため局所計算する。
  const out = {} as Record<CandlePatternId, boolean>;
  for (const id of ALL_CANDLE_PATTERN_IDS) out[id] = false;

  const b = bars[index];
  const body = Math.abs(b.close - b.open);
  const rng = Math.max(b.high - b.low, 0.0);
  const upper = b.high - Math.max(b.open, b.close);
  const lower = Math.min(b.open, b.close) - b.low;

  if (body > 0) {
    out.pinbar_bull = lower >= 3.0 * body && upper <= 0.5 * body;
    out.pinbar_bear = upper >= 3.0 * body && lower <= 0.5 * body;
    out.pinbar = out.pinbar_bull || out.pinbar_bear;
  }

  if (rng > 0) {
    const isHammer = lower >= 2.0 * body && upper <= 0.5 * body;
    out.hammer = isHammer;
    out.hammer_bull = isHammer && b.close > b.open;
    out.hammer_bear = isHammer && b.close < b.open;

    out.shooting_star = upper >= 2.0 * body && lower <= 0.5 * body;
    out.doji = body <= 0.1 * rng;

    const isThrust = body >= 0.7 * rng;
    out.thrust_bull = isThrust && b.close > b.open;
    out.thrust_bear = isThrust && b.close < b.open;
  }

  if (index > 0) {
    const prev = bars[index - 1];
    const prevBear = prev.close < prev.open;
    const prevBull = prev.close > prev.open;
    const currBull = b.close > b.open;
    const currBear = b.close < b.open;
    out.engulfing_bull =
      prevBear && currBull && b.open <= prev.close && b.close >= prev.open;
    out.engulfing_bear =
      prevBull && currBear && b.open >= prev.close && b.close <= prev.open;
  }

  return out;
}
