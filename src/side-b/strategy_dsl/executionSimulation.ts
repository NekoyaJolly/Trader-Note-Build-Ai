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
} from './dslBacktestSimulation';

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
