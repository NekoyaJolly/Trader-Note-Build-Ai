/**
 * Phase 6.8: 本番執行シミュレーション設定
 *
 * LLM ではなく決定論的コードで、バックテストの執行・摩擦仮定を管理する。
 */

import { createHash } from 'crypto';
import type {
  DslSimulationOptions,
  ImmediateEntryFill,
  IntraBarExitMode,
} from './surrogateFitnessSimulation';

export type ExecutionModel = 'legacy_zero_cost' | 'bar_l1_v1' | 'bar_l2_v1';
export type ExecutionDataSource = 'ctrader';

export interface ExecutionSimulationConfig {
  model: ExecutionModel;
  dataSource?: ExecutionDataSource;
  initialCapital?: number;
  lotSize?: number;
  intraBarExitMode?: IntraBarExitMode;
  immediateEntryFill?: ImmediateEntryFill;
  /** レベル1: 往復のスプレッド + 手数料を pips として控除 */
  roundTripCostPips?: number;
  /** レベル2準備: ATR 比例のスリッページ/拡大スプレッド控除 */
  roundTripCostAtrMult?: number;
}

export interface ExecutionCostSummary {
  model: ExecutionModel;
  dataSource: ExecutionDataSource;
  roundTripCostPips: number;
  roundTripCostAtrMult: number;
  totalCost: number;
}

export interface ExecutionSimulationMetadata {
  executionModel: ExecutionModel;
  executionConfigHash: string;
  dataSource: ExecutionDataSource;
  costSummary: ExecutionCostSummary;
}

export interface SymbolExecutionCostProfile {
  symbol: string;
  /** 往復の spread + commission + 最小 slippage を pips 換算した保守値 */
  roundTripCostPips: number;
  /** ATR 比例の追加スリッページ（初期は控えめ、必要なら銘柄別に拡張） */
  roundTripCostAtrMult: number;
  rationale: string;
}

export const LEGACY_ZERO_COST_EXECUTION: ExecutionSimulationConfig = {
  model: 'legacy_zero_cost',
  dataSource: 'ctrader',
  roundTripCostPips: 0,
  roundTripCostAtrMult: 0,
};

export const DEFAULT_L1_EXECUTION: ExecutionSimulationConfig = {
  model: 'bar_l1_v1',
  dataSource: 'ctrader',
  intraBarExitMode: 'pessimistic',
  immediateEntryFill: 'next_bar_open',
  roundTripCostPips: 0,
  roundTripCostAtrMult: 0,
};

export const DEFAULT_L2_ROUND_TRIP_COST_PIPS = 2.0;

/**
 * Phase 6.8: 商用最小BT用の固定コスト表。
 *
 * cTrader の実 bid/ask 時系列へ移行するまでの保守値。値は「往復」pips。
 */
export const SYMBOL_EXECUTION_COST_PROFILES: readonly SymbolExecutionCostProfile[] = [
  {
    symbol: 'XAUUSD',
    roundTripCostPips: 3.0,
    roundTripCostAtrMult: 0.02,
    rationale: 'Gold はスプレッド拡大が出やすいため、固定往復3pips + ATR 2%を初期保守値にする',
  },
  {
    symbol: 'EURUSD',
    roundTripCostPips: 1.2,
    roundTripCostAtrMult: 0.01,
    rationale: '主要FXの代表として低めだがゼロではない往復コストを置く',
  },
  {
    symbol: 'USDJPY',
    roundTripCostPips: 1.5,
    roundTripCostAtrMult: 0.01,
    rationale: 'JPYペアの代表として往復1.5pipsを初期保守値にする',
  },
] as const;

function normalizeSymbol(symbol: string): string {
  return symbol.toUpperCase().replace(/[^A-Z]/g, '');
}

/**
 * シンボルの 1 pip の価格幅を返す。
 * 既存の L2 実行コスト換算（createL2ExecutionConfigFromSpreadBars）と同じ規約で、
 * pips ↔ 価格の変換を行う箇所で唯一の正とする（GOLD/XAU=0.1, JPY ペア=0.01, その他=0.0001）。
 */
export function getPipSize(symbol: string): number {
  const s = normalizeSymbol(symbol);
  if (s.includes('XAU') || s.includes('GOLD')) return 0.1;
  if (s.includes('JPY')) return 0.01;
  return 0.0001;
}

export function getExecutionCostProfile(symbol: string): SymbolExecutionCostProfile {
  const normalized = normalizeSymbol(symbol);
  const exact = SYMBOL_EXECUTION_COST_PROFILES.find((p) => normalizeSymbol(p.symbol) === normalized);
  if (exact) return exact;
  return {
    symbol: normalized || 'DEFAULT',
    roundTripCostPips: DEFAULT_L2_ROUND_TRIP_COST_PIPS,
    roundTripCostAtrMult: 0.01,
    rationale: '未定義シンボルのため、保守的な固定往復2pips + ATR 1%を適用',
  };
}

/**
 * env 値を「文字列全体が数値のときだけ」受理する厳密パース。
 * `parseFloat` は `'2abc'` を 2 として受理してしまい誤設定を silent に通すため、
 * Side-B の他の env 解釈 (parseStrictInt 等) と揃えて trim + 全体一致で検証する。
 * 不正値は null を返し、呼び出し側が既定値へフォールバックする。
 */
function parseStrictFloat(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * SL 最小フロアを「往復コスト pips の何倍にするか」の係数。
 * ATR 基準 SL が低ボラ局面で往復コストに飲まれるのを防ぐ最低マージン。
 * env `SL_FLOOR_COST_MULT` で調整可 (既定 2 = コストの 2 倍を最低 SL とする)。
 */
function getSlFloorCostMultiplier(): number {
  const parsed = parseStrictFloat(process.env.SL_FLOOR_COST_MULT);
  return parsed !== null && parsed >= 0 ? parsed : 2;
}

/**
 * SL 最大キャップ (pips) のシンボル別表。高ボラ局面で ATR 基準 SL が過大になり
 * ポジションが極小化するのを抑える。コスト比は銘柄間の「妥当な最大SL」とスケールが
 * 合わないため、銘柄の実動き幅に合わせた絶対 pips で持つ (Nekoさん 決定)。
 */
export const SYMBOL_MAX_STOP_LOSS_PIPS: Readonly<Record<string, number>> = {
  XAUUSD: 80,
  EURUSD: 40,
  USDJPY: 40,
};

/** 未定義シンボルの SL 最大キャップ (pips)。env `SL_MAX_PIPS_DEFAULT` で調整可。 */
function getDefaultMaxStopLossPips(): number {
  const parsed = parseStrictFloat(process.env.SL_MAX_PIPS_DEFAULT);
  return parsed !== null && parsed > 0 ? parsed : 60;
}

/**
 * シンボルの SL clamp 境界 (pips) を返す。
 * - minPips: 往復コスト pips × フロア係数 (低ボラで SL が縮みすぎるのを防ぐ)
 * - maxPips: シンボル別の絶対上限 (高ボラで SL が過大になるのを抑える)
 *
 * analysis-engine には pips で渡し、向こうで pipSize と掛けて価格距離に換算する
 * (= コスト spreadPips と同じ pipSize 基準で整合させる)。
 */
export function getStopLossClampPips(symbol: string): { minPips: number; maxPips: number } {
  const profile = getExecutionCostProfile(symbol);
  const minPips = profile.roundTripCostPips * getSlFloorCostMultiplier();
  const normalized = normalizeSymbol(symbol);
  const maxPips = SYMBOL_MAX_STOP_LOSS_PIPS[normalized] ?? getDefaultMaxStopLossPips();
  return { minPips, maxPips };
}

export function createDefaultL2ExecutionConfig(symbol: string): ExecutionSimulationConfig {
  const profile = getExecutionCostProfile(symbol);
  return {
    model: 'bar_l2_v1',
    dataSource: 'ctrader',
    intraBarExitMode: 'pessimistic',
    immediateEntryFill: 'next_bar_open',
    roundTripCostPips: profile.roundTripCostPips,
    roundTripCostAtrMult: profile.roundTripCostAtrMult,
  };
}

export interface SpreadBarCostInput {
  p95Spread: number;
}

export function createL2ExecutionConfigFromSpreadBars(
  symbol: string,
  spreadBars: readonly SpreadBarCostInput[],
): ExecutionSimulationConfig {
  if (spreadBars.length === 0) {
    return createDefaultL2ExecutionConfig(symbol);
  }
  const avgP95Spread =
    spreadBars.reduce((sum, bar) => sum + Math.max(0, bar.p95Spread), 0) / spreadBars.length;
  const pipSize = getPipSize(symbol);
  const spreadPips = pipSize > 0 ? avgP95Spread / pipSize : DEFAULT_L2_ROUND_TRIP_COST_PIPS;
  const fallback = getExecutionCostProfile(symbol);
  return {
    model: 'bar_l2_v1',
    dataSource: 'ctrader',
    intraBarExitMode: 'pessimistic',
    immediateEntryFill: 'next_bar_open',
    // tick由来 p95 を優先しつつ、最小でも固定表の半分は残す（手数料/スリッページ分）
    roundTripCostPips: Math.max(spreadPips, fallback.roundTripCostPips * 0.5),
    roundTripCostAtrMult: fallback.roundTripCostAtrMult,
  };
}

export function normalizeExecutionConfig(
  config?: ExecutionSimulationConfig,
): Required<Pick<ExecutionSimulationConfig, 'model' | 'dataSource'>> &
  Omit<ExecutionSimulationConfig, 'model' | 'dataSource'> {
  const base = config ?? LEGACY_ZERO_COST_EXECUTION;
  return {
    ...base,
    model: base.model,
    dataSource: base.dataSource ?? 'ctrader',
    roundTripCostPips: Math.max(0, base.roundTripCostPips ?? 0),
    roundTripCostAtrMult: Math.max(0, base.roundTripCostAtrMult ?? 0),
  };
}

export function hashExecutionConfig(config?: ExecutionSimulationConfig): string {
  const normalized = normalizeExecutionConfig(config);
  const stable = JSON.stringify(
    Object.fromEntries(Object.entries(normalized).sort(([a], [b]) => a.localeCompare(b))),
  );
  return createHash('sha256').update(stable).digest('hex').slice(0, 16);
}

export function toDslSimulationOptions(
  config?: ExecutionSimulationConfig,
): DslSimulationOptions {
  const normalized = normalizeExecutionConfig(config);
  return {
    initialCapital: normalized.initialCapital,
    lotSize: normalized.lotSize,
    intraBarExitMode: normalized.intraBarExitMode,
    immediateEntryFill: normalized.immediateEntryFill,
    roundTripCostPips: normalized.roundTripCostPips,
    roundTripCostAtrMult: normalized.roundTripCostAtrMult,
    executionModel: normalized.model,
    executionConfigHash: hashExecutionConfig(normalized),
    executionDataSource: normalized.dataSource,
  };
}
