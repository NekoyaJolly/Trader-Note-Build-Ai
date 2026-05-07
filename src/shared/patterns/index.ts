/**
 * ローソク足パターン共通定義 (PR ②-1, PR ④F で計算経路撤廃)。
 *
 * 役割:
 * - **型 + ID 集合の単一情報源**。`CandlePatternId` (= patternId 文字列リテラル
 *   union) と `ALL_CANDLE_PATTERN_IDS` (= 順序固定 tuple) を提供する。
 * - registry (`./registry.ts`) と prompt 整形 (`./promptTable.ts`) はこの型を
 *   import して使う。
 *
 * **計算は持たない**:
 * - PR ④F で TS 側 pattern 判定は撤廃。真実は **analysis-engine
 *   `compute_pinbar_flags` / `compute_candlestick_pattern_flags`**
 *   (= pandas/numpy 実装)。
 * - Side-B 進化ループは `EvolutionLoop` が世代開始時に
 *   `/v1/indicator-series` でまとめて pattern flags を取得し、surrogate に
 *   `DslSimulationOptions.patternFlagsCache` 経由で渡す。
 * - 旧 PR ②-1 の `computeAllPatternFlags` / `patternFlagsAtIndex` /
 *   `computePinbarFlags` / `computeCandlestickPatternFlags` は撤廃済み。
 *
 * @see analysis-engine/app/indicators.py compute_pinbar_flags
 * @see analysis-engine/app/indicators.py compute_candlestick_pattern_flags
 */

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
