/**
 * 進化ループ再設計 Phase 3: Crossover「インジ追加エッジ発見」用のエッジ条件テンプレート表。
 *
 * 設計（docs/diagnostics/evolution_loop_redesign_plan_2026-06-02.html §2-2）:
 * - registry の python 対応インジを系統的に 1 つずつ親へ AND 追加して BT し、
 *   「負けが減り勝ちが維持される」組合せを採用する（決定論スイープが土台、LLM は事前絞り込みのみ）。
 * - 各インジは direction（long/short）に応じた標準エッジ条件を持ち、閾値・期間を複数候補で
 *   スイープする（Nekoさん 指摘: 追加インジ自身のパラメータも動かす）。
 *
 * 本ファイルは純粋データ（テンプレート表）。条件の組み立て・スイープは crossoverVariants.ts。
 *
 * カバレッジ方針（正確性優先）:
 * - **単一 series ('value') で意味が明確なインジのみ**テンプレート化する。
 *   - oscillator_threshold: 値が閾値レンジを持つ（rsi / williamsR / mfi / cci / roc / cmf）。
 *   - price_vs_ma: 終値との比較で順張りフィルタになる MA（ema / sma / dema / tema）。
 * - 多出力 / バンド / フィールド依存（macd, bb, kc, stochastic, aroon, psar, ichimoku,
 *   atr, obv, vwap）は field 別評価が必要で、誤テンプレートは「常時 false」変異を生むため
 *   **本 Phase では除外**（crossoverVariants が「未テンプレート」としてログ）。拡張は Phase 3b。
 */

import type { IndicatorId } from '../../shared/indicators/registry';
import type { ConditionValue } from './schema';

/** direction 別の閾値スイープ条件（feature 値 op 閾値）。 */
export interface OscillatorThresholdSpec {
  kind: 'oscillator_threshold';
  /** long エントリー向けエッジ（例 rsi `<` [25,30,35] = 売られ過ぎ）。 */
  long: { op: '<' | '>'; thresholds: number[] };
  /** short エントリー向けエッジ（例 rsi `>` [65,70,75] = 買われ過ぎ）。 */
  short: { op: '<' | '>'; thresholds: number[] };
  /** period 系 param キー（無ければ undefined）。 */
  periodParamKey?: string;
  /** スイープする period 候補。 */
  periodCandidates?: number[];
}

/** 終値 vs MA（compareTarget）の順張りフィルタ。long=close>MA / short=close<MA。 */
export interface PriceVsMaSpec {
  kind: 'price_vs_ma';
  periodParamKey: string;
  periodCandidates: number[];
}

export type EdgeConditionTemplate = (OscillatorThresholdSpec | PriceVsMaSpec) & {
  indicatorId: IndicatorId;
};

/**
 * エッジ条件テンプレート表（python 対応 + 単一 series で意味明確なインジのみ）。
 * 閾値・period はいずれも複数候補でスイープ対象。
 */
export const CROSSOVER_EDGE_TEMPLATES: readonly EdgeConditionTemplate[] = Object.freeze([
  // ---- oscillator_threshold（売られ/買われ過ぎ・モメンタム） ----
  {
    indicatorId: 'rsi',
    kind: 'oscillator_threshold',
    long: { op: '<', thresholds: [25, 30, 35] },
    short: { op: '>', thresholds: [65, 70, 75] },
    periodParamKey: 'period',
    periodCandidates: [9, 14, 21],
  },
  {
    indicatorId: 'williamsR',
    kind: 'oscillator_threshold',
    long: { op: '<', thresholds: [-85, -80, -75] },
    short: { op: '>', thresholds: [-25, -20, -15] },
    periodParamKey: 'period',
    periodCandidates: [14, 21],
  },
  {
    indicatorId: 'mfi',
    kind: 'oscillator_threshold',
    long: { op: '<', thresholds: [15, 20, 25] },
    short: { op: '>', thresholds: [75, 80, 85] },
    periodParamKey: 'period',
    periodCandidates: [14, 21],
  },
  {
    indicatorId: 'cci',
    kind: 'oscillator_threshold',
    long: { op: '<', thresholds: [-150, -100] },
    short: { op: '>', thresholds: [100, 150] },
    periodParamKey: 'period',
    periodCandidates: [14, 20],
  },
  {
    indicatorId: 'roc',
    kind: 'oscillator_threshold',
    // モメンタム順張り: long=正のモメンタム / short=負のモメンタム。
    long: { op: '>', thresholds: [0] },
    short: { op: '<', thresholds: [0] },
    periodParamKey: 'period',
    periodCandidates: [9, 14],
  },
  {
    indicatorId: 'cmf',
    kind: 'oscillator_threshold',
    // 資金フロー: long=買い圧 (>0) / short=売り圧 (<0)。
    long: { op: '>', thresholds: [0] },
    short: { op: '<', thresholds: [0] },
    periodParamKey: 'period',
    periodCandidates: [20],
  },
  // ---- price_vs_ma（順張りトレンドフィルタ: 終値 vs MA） ----
  { indicatorId: 'ema', kind: 'price_vs_ma', periodParamKey: 'period', periodCandidates: [20, 50, 100] },
  { indicatorId: 'sma', kind: 'price_vs_ma', periodParamKey: 'period', periodCandidates: [20, 50, 100] },
  { indicatorId: 'dema', kind: 'price_vs_ma', periodParamKey: 'period', periodCandidates: [20, 50] },
  { indicatorId: 'tema', kind: 'price_vs_ma', periodParamKey: 'period', periodCandidates: [20, 50] },
]);

/** テンプレート化済みインジ ID 集合（crossoverVariants の skip ログ判定用）。 */
export const TEMPLATED_INDICATOR_IDS: ReadonlySet<string> = new Set(
  CROSSOVER_EDGE_TEMPLATES.map((t) => t.indicatorId),
);

/** value 候補（数値）を ConditionValue として扱うためのヘルパ型エクスポート。 */
export type EdgeThreshold = ConditionValue;
