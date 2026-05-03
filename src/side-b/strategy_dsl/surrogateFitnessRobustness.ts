/**
 * SurrogateFitnessRobustness (Critical-4 段階 4a で `dslBacktestRobustness.ts` から改名)
 *
 * **これは進化計算 (EvolutionLoop) 用の近似 fitness のロバストネス分析であり、
 * 正式な BT 結果ではない**。
 *
 * 執行仮定の複数本 (悲観〜楽観・固定コスト〜ATR 比例) を束ねて、PF の感度帯域を見るための
 * surrogate fitness 評価ヘルパー。`SurrogateFitnessSimulator` から呼ばれる。
 *
 * **本番採用 / confirmed 昇格 / ユーザー表示** は analysis-engine の結果 (ScreeningBacktestRun)
 * のみを正とする (Critical-4 設計書 §13)。本ファイルの値は探索の進化的選択にのみ使用する。
 *
 * @see docs/design/critical_4_bt_unification.md §13
 */

import type { BacktestResultSummary } from '../../backend/services/backtestCalculations';
import { fetchHistoricalData } from '../../backend/services/strategyBacktestService';
import {
  SurrogateFitnessSimulator,
  dslTimeframeToBacktestTf,
  type BacktestPeriod,
  type SurrogateFitnessAggregate,
} from './SurrogateFitnessSimulator';
import type { DslSimulationOptions, OhlcvBar } from './surrogateFitnessSimulation';
import type { StrategyDSL } from './schema';

/** 1 本の仮定ラベル付きシナリオ */
export interface DslRobustnessScenario {
  /** レポート用短いID（例: C1） */
  id: string;
  /** 人間向け説明 */
  label: string;
  options: DslSimulationOptions;
}

/**
 * 既定の比較セット（XAU/FX 向け。番号は感度帯域の枠を示し最適解ではない）
 * - 保守寄り: 次足建・往復pips 系
 * - 上界参考: コスト0・終値建（理論的に厚く見えがちなので「参考」扱い）
 */
export function defaultCommercialScenarios(): DslRobustnessScenario[] {
  return [
    {
      id: 'C1',
      label: '保守: 同バー悲観・次足始値建・往復2p',
      options: {
        intraBarExitMode: 'pessimistic',
        immediateEntryFill: 'next_bar_open',
        roundTripCostPips: 2,
      },
    },
    {
      id: 'C2',
      label: '保守+変動: C1 + 往復0.1×ATR(14)',
      options: {
        intraBarExitMode: 'pessimistic',
        immediateEntryFill: 'next_bar_open',
        roundTripCostPips: 2,
        roundTripCostAtrMult: 0.1,
      },
    },
    {
      id: 'C3',
      label: '厳: 2p + 0.2×ATR(14)・次足建',
      options: {
        intraBarExitMode: 'pessimistic',
        immediateEntryFill: 'next_bar_open',
        roundTripCostPips: 2,
        roundTripCostAtrMult: 0.2,
      },
    },
    {
      id: 'O1',
      label: '参考(上界寄り): 悲観・終値建・往復コスト0',
      options: {
        intraBarExitMode: 'pessimistic',
        immediateEntryFill: 'signal_bar_close',
      },
    },
  ];
}

/** 1 シナリオ分の学習/検証集計 */
export interface DslRobustnessRun {
  scenario: DslRobustnessScenario;
  aggregate: SurrogateFitnessAggregate;
}

export interface SurrogateFitnessRobustnessReport {
  dslId: string;
  period: BacktestPeriod;
  runs: DslRobustnessRun[];
  /** 検証期間 PF の min/max（帯域） */
  validationPfMin: number;
  validationPfMax: number;
  /** 上記レンジ幅 */
  validationPfRange: number;
}

function safeFinitePf(s: BacktestResultSummary): number {
  const pf = s.profitFactor;
  if (Number.isFinite(pf)) return pf;
  if (s.totalTrades === 0) return 0;
  return 10;
}

/**
 * 取得済み OHLCV について、各シナリオで学習/検証集計を返す
 */
export function runSurrogateFitnessRobustnessOnBars(
  dsl: StrategyDSL,
  paramValues: Record<string, number>,
  period: BacktestPeriod,
  bars: OhlcvBar[],
  scenarios: DslRobustnessScenario[] = defaultCommercialScenarios(),
): SurrogateFitnessRobustnessReport {
  const adapter = new SurrogateFitnessSimulator();
  const runs: DslRobustnessRun[] = scenarios.map((scenario) => ({
    scenario,
    aggregate: adapter.evaluateFitnessOnBars(dsl, paramValues, period, bars, scenario.options),
  }));

  const valPfs = runs.map((r) => safeFinitePf(r.aggregate.validation.summary));
  const validationPfMin = valPfs.length > 0 ? Math.min(...valPfs) : 0;
  const validationPfMax = valPfs.length > 0 ? Math.max(...valPfs) : 0;

  return {
    dslId: dsl.id,
    period,
    runs,
    validationPfMin,
    validationPfMax,
    validationPfRange: validationPfMax - validationPfMin,
  };
}

/**
 * 期間内 OHLCV を fetch してからロバストネス比較（1 本の DSL・複数仮定）
 */
export async function runSurrogateFitnessRobustness(
  dsl: StrategyDSL,
  paramValues: Record<string, number>,
  period: BacktestPeriod,
  scenarios: DslRobustnessScenario[] = defaultCommercialScenarios(),
): Promise<SurrogateFitnessRobustnessReport> {
  const symbol = dsl.symbol.replace(/\//g, '');
  const btTf = dslTimeframeToBacktestTf(dsl.timeframe);
  const start = new Date(period.start);
  const end = new Date(period.end);
  const bars = await fetchHistoricalData(symbol, btTf, start, end);
  return runSurrogateFitnessRobustnessOnBars(dsl, paramValues, period, bars, scenarios);
}
