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
  const pipSize = (() => {
    const s = symbol.toUpperCase().replace(/[^A-Z]/g, '');
    if (s.includes('XAU') || s.includes('GOLD')) return 0.1;
    if (s.includes('JPY')) return 0.01;
    return 0.0001;
  })();
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
