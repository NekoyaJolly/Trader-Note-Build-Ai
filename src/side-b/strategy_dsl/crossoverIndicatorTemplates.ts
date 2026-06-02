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
 * カバレッジ方針（Hybrid Redesign）:
 * - Python 対応 20 指標をすべてテンプレート化する。
 * - 多出力 / バンド / フィールド依存は `featureKey` alias
 *   (例: macd_histogram / bb_upper / ichimoku_kijun) で表現し、
 *   analysis-engine 側では indicatorId + field に解決する。
 */

import type { IndicatorId } from '../../shared/indicators/registry';
import type { ConditionValue } from './schema';

/** direction 別の閾値スイープ条件（feature 値 op 閾値）。 */
export interface OscillatorThresholdSpec {
  kind: 'oscillator_threshold';
  /** DSL に出す feature。未指定なら indicatorId をそのまま使う。 */
  featureKey?: string;
  /** long エントリー向けエッジ（例 rsi `<` [25,30,35] = 売られ過ぎ）。 */
  long: { op: '<' | '>'; thresholds: number[] };
  /** short エントリー向けエッジ（例 rsi `>` [65,70,75] = 買われ過ぎ）。 */
  short: { op: '<' | '>'; thresholds: number[] };
  /** period 系 param キー（無ければ undefined）。 */
  periodParamKey?: string;
  /** スイープする period 候補。 */
  periodCandidates?: number[];
  /** MACD / Stochastic など複数 param 系の固定値。 */
  fixedParams?: Readonly<Record<string, number>>;
}

/** 終値 vs MA（compareTarget）の順張りフィルタ。long=close>MA / short=close<MA。 */
export interface PriceVsMaSpec {
  kind: 'price_vs_ma';
  /** compareTarget に使う DSL feature。未指定なら indicatorId をそのまま使う。 */
  featureKey?: string;
  periodParamKey: string;
  periodCandidates: number[];
  fixedParams?: Readonly<Record<string, number>>;
}

export type EdgeConditionTemplate = (OscillatorThresholdSpec | PriceVsMaSpec) & {
  indicatorId: IndicatorId;
};

/** Hybrid Redesign の公開名。既存 EdgeConditionTemplate と同じ構造。 */
export type CrossoverEdgeTemplate = EdgeConditionTemplate;

/**
 * エッジ条件テンプレート表（python 対応 + 単一 series で意味明確なインジのみ）。
 * 閾値・period はいずれも複数候補でスイープ対象。
 */
const CROSSOVER_EDGE_TEMPLATE_LIST: EdgeConditionTemplate[] = [
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
    indicatorId: 'stochastic',
    featureKey: 'stochastic_k',
    kind: 'oscillator_threshold',
    long: { op: '<', thresholds: [20, 30] },
    short: { op: '>', thresholds: [70, 80] },
    periodParamKey: 'kPeriod',
    periodCandidates: [9, 14, 21],
    fixedParams: { dPeriod: 3 },
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
    indicatorId: 'macd',
    featureKey: 'macd_histogram',
    kind: 'oscillator_threshold',
    long: { op: '>', thresholds: [0] },
    short: { op: '<', thresholds: [0] },
    fixedParams: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
  },
  {
    indicatorId: 'aroon',
    kind: 'oscillator_threshold',
    long: { op: '>', thresholds: [0, 20] },
    short: { op: '<', thresholds: [-20, 0] },
    periodParamKey: 'period',
    periodCandidates: [14, 25],
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
  {
    indicatorId: 'atr',
    kind: 'oscillator_threshold',
    long: { op: '<', thresholds: [0.001, 0.002, 0.005] },
    short: { op: '<', thresholds: [0.001, 0.002, 0.005] },
    periodParamKey: 'period',
    periodCandidates: [14, 21],
  },
  {
    indicatorId: 'obv',
    kind: 'oscillator_threshold',
    long: { op: '>', thresholds: [0] },
    short: { op: '<', thresholds: [0] },
  },
  // ---- price_vs_ma（順張りトレンドフィルタ: 終値 vs MA） ----
  { indicatorId: 'ema', kind: 'price_vs_ma', periodParamKey: 'period', periodCandidates: [20, 50, 100] },
  { indicatorId: 'sma', kind: 'price_vs_ma', periodParamKey: 'period', periodCandidates: [20, 50, 100] },
  { indicatorId: 'dema', kind: 'price_vs_ma', periodParamKey: 'period', periodCandidates: [20, 50] },
  { indicatorId: 'tema', kind: 'price_vs_ma', periodParamKey: 'period', periodCandidates: [20, 50] },
  { indicatorId: 'psar', kind: 'price_vs_ma', periodParamKey: 'step', periodCandidates: [0.02], fixedParams: { maxStep: 0.2 } },
  { indicatorId: 'ichimoku', featureKey: 'ichimoku_kijun', kind: 'price_vs_ma', periodParamKey: 'basePeriod', periodCandidates: [26, 52], fixedParams: { conversionPeriod: 9, spanBPeriod: 52 } },
  { indicatorId: 'bb', featureKey: 'bb_upper', kind: 'price_vs_ma', periodParamKey: 'period', periodCandidates: [20, 30] },
  { indicatorId: 'kc', featureKey: 'kc_upper', kind: 'price_vs_ma', periodParamKey: 'period', periodCandidates: [20, 30], fixedParams: { multiplier: 2 } },
  { indicatorId: 'vwap', kind: 'price_vs_ma', periodParamKey: 'period', periodCandidates: [1] },
];

export const CROSSOVER_EDGE_TEMPLATES: readonly EdgeConditionTemplate[] = Object.freeze(
  CROSSOVER_EDGE_TEMPLATE_LIST,
);

/** テンプレート化済みインジ ID 集合（crossoverVariants の skip ログ判定用）。 */
export const TEMPLATED_INDICATOR_IDS: ReadonlySet<string> = new Set(
  CROSSOVER_EDGE_TEMPLATES.map((t) => t.indicatorId),
);

/** value 候補（数値）を ConditionValue として扱うためのヘルパ型エクスポート。 */
export type EdgeThreshold = ConditionValue;
