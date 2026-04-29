/**
 * DSL バックテストの窓口（Phase 5）
 *
 * OHLCV を取得して dslBacktestSimulation に渡す。
 * 学習/検証期間分割・パラメータスイープを担当。
 *
 * @see docs/design/phase_5_specification.md §4.3
 */

import { fetchHistoricalData, type BacktestTimeframe } from '../../backend/services/strategyBacktestService';
import type { BacktestResultSummary, BacktestTradeEvent } from '../../backend/services/backtestCalculations';
import {
  runDslSimulation,
  type DslSimulationOptions,
  type OhlcvBar,
} from './dslBacktestSimulation';
import type { ExecutionSimulationMetadata } from './executionSimulation';
import type { StrategyDSL } from './schema';
import {
  defaultParameterValues,
  enumerateParameterGrid,
  valuesForParameterField,
} from './dslParameterUtils';
import { isLegacyParameterDef, isParameterRangeV2 } from './types';

/** profitFactor が Infinity のときも数値計算できるよう上限化 */
function safeProfitFactor(s: BacktestResultSummary): number {
  const pf = s.profitFactor;
  if (Number.isFinite(pf)) return pf;
  if (s.totalTrades === 0) return 0;
  return 10;
}

/** timeframe 文字列を BacktestTimeframe にマップ（未知は 1h） */
export function dslTimeframeToBacktestTf(tf: string): BacktestTimeframe {
  const t = tf.trim().toLowerCase();
  const map: Record<string, BacktestTimeframe> = {
    '1m': '1m',
    '5m': '5m',
    '15m': '15m',
    '30m': '30m',
    '1h': '1h',
    '4h': '4h',
    '1d': '1d',
  };
  return map[t] ?? '1h';
}

export interface BacktestPeriod {
  start: string;
  end: string;
}

export interface DslBacktestAggregate {
  dslId: string;
  period: BacktestPeriod;
  /** 学習期間 */
  train: {
    summary: BacktestResultSummary;
    trades: BacktestTradeEvent[];
  };
  /** 検証期間（未知データ） */
  validation: {
    summary: BacktestResultSummary;
    trades: BacktestTradeEvent[];
  };
  /** 単純過学習指標: |trainPF - valPF| / max(trainPF, ε) */
  overfitScore: number;
  /** 学習 PF */
  trainPf: number;
  /** 検証 PF */
  validationPf: number;
  /** Phase 6.8: 執行・コスト仮定（検証期間側を代表値として扱う） */
  execution: ExecutionSimulationMetadata;
}

/**
 * Side-B 検証ツールに渡す DSL BT 要約（Phase 6.7b）
 * 検証期間（ホールドアウト）のトレードを主に用いる。
 */
export interface DSLBacktestResult {
  dslId: string;
  period: BacktestPeriod;
  /** 検証期間の各トレード PnL */
  pnls: number[];
  /** Phase 6.8: 価格差のみの PnL */
  grossPnls: number[];
  /** Phase 6.8: コスト控除後 PnL（pnls と同一） */
  netPnls: number[];
  /** 検証期間のトレード（WalkForward 等） */
  events: BacktestTradeEvent[];
  /** 検証期間の netProfitRate（相対表現、Side-A 集計に準拠） */
  finalReturn: number;
  overfitScore: number;
  trainPf: number;
  validationPf: number;
  /** 当該集計に用いた最適化後パラメータ（スイープ時の1組） */
  optimizedParams: Record<string, number>;
  /** Phase 6.8: 執行・コスト仮定 */
  executionModel: string;
  executionConfigHash: string;
  dataSource: string;
  costSummary: ExecutionSimulationMetadata['costSummary'];
}

/**
 * 集計と最適化パラメータから ValidationTool 向け DTO を生成
 */
export function toDSLBacktestResult(
  aggregate: DslBacktestAggregate,
  optimizedParams: Record<string, number>,
): DSLBacktestResult {
  const ev = aggregate.validation.trades;
  const pnls = ev.map((e) => (typeof e.pnl === 'number' && Number.isFinite(e.pnl) ? e.pnl : 0));
  const grossPnls = ev.map((e) => {
    const gross = e.indicatorValues?.grossPnl;
    return typeof gross === 'number' && Number.isFinite(gross) ? gross : e.pnl;
  });
  return {
    dslId: aggregate.dslId,
    period: aggregate.period,
    pnls,
    grossPnls,
    netPnls: pnls,
    events: ev,
    finalReturn: aggregate.validation.summary.netProfitRate,
    overfitScore: aggregate.overfitScore,
    trainPf: aggregate.trainPf,
    validationPf: aggregate.validationPf,
    optimizedParams: { ...optimizedParams },
    executionModel: aggregate.execution.executionModel,
    executionConfigHash: aggregate.execution.executionConfigHash,
    dataSource: aggregate.execution.dataSource,
    costSummary: { ...aggregate.execution.costSummary },
  };
}

export class DSLBacktestAdapter {
  /**
   * 指定期間の OHLCV でバックテスト。
   * 期間の 70% を学習・30% を検証に分割。
   */
  async runBacktest(
    dsl: StrategyDSL,
    paramValues: Record<string, number>,
    period: BacktestPeriod,
    simulationOptions?: DslSimulationOptions,
  ): Promise<DslBacktestAggregate> {
    const symbol = dsl.symbol.replace(/\//g, '');
    const btTf = dslTimeframeToBacktestTf(dsl.timeframe);
    const start = new Date(period.start);
    const end = new Date(period.end);

    const bars = await fetchHistoricalData(symbol, btTf, start, end);
    return this.runBacktestOnBars(dsl, paramValues, period, bars, simulationOptions);
  }

  /**
   * 取得済み OHLCV で集計（テスト用）
   */
  runBacktestOnBars(
    dsl: StrategyDSL,
    paramValues: Record<string, number>,
    period: BacktestPeriod,
    bars: OhlcvBar[],
    simulationOptions?: DslSimulationOptions,
  ): DslBacktestAggregate {
    if (bars.length < 30) {
      const empty: BacktestResultSummary = {
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRate: 0,
        netProfit: 0,
        netProfitRate: 0,
        maxDrawdown: 0,
        maxDrawdownRate: 0,
        profitFactor: 0,
        averageWin: 0,
        averageLoss: 0,
        riskRewardRatio: 0,
        maxConsecutiveWins: 0,
        maxConsecutiveLosses: 0,
      };
      return {
        dslId: dsl.id,
        period,
        train: { summary: empty, trades: [] },
        validation: { summary: empty, trades: [] },
        overfitScore: 1,
        trainPf: 0,
        validationPf: 0,
        execution: {
          executionModel: simulationOptions?.executionModel ?? 'legacy_zero_cost',
          executionConfigHash: simulationOptions?.executionConfigHash ?? 'legacy-zero-cost',
          dataSource: simulationOptions?.executionDataSource ?? 'ctrader',
          costSummary: {
            model: simulationOptions?.executionModel ?? 'legacy_zero_cost',
            dataSource: simulationOptions?.executionDataSource ?? 'ctrader',
            roundTripCostPips: Math.max(0, simulationOptions?.roundTripCostPips ?? 0),
            roundTripCostAtrMult: Math.max(0, simulationOptions?.roundTripCostAtrMult ?? 0),
            totalCost: 0,
          },
        },
      };
    }

    const split = Math.max(20, Math.floor(bars.length * 0.7));
    const trainBars = bars.slice(0, split);
    const valBars = bars.slice(split);

    const mergedParams = { ...defaultParameterValues(dsl), ...paramValues };
    const trainResult = runDslSimulation(trainBars, dsl, mergedParams, simulationOptions);
    const valResult = runDslSimulation(valBars, dsl, mergedParams, simulationOptions);

    const trainPf = safeProfitFactor(trainResult.summary);
    const validationPf = safeProfitFactor(valResult.summary);
    const eps = 1e-6;
    const overfitScore = Math.abs(trainPf - validationPf) / Math.max(trainPf, eps);

    return {
      dslId: dsl.id,
      period,
      train: { summary: trainResult.summary, trades: trainResult.trades },
      validation: { summary: valResult.summary, trades: valResult.trades },
      overfitScore,
      trainPf,
      validationPf,
      execution: valResult.execution,
    };
  }

  /**
   * パラメータ空間を走査（グリッド / ランダム / default のみ）
   */
  async runWithParameterSweep(
    dsl: StrategyDSL,
    period: BacktestPeriod,
    samplingStrategy: 'grid' | 'random' | 'default',
    sampleCount?: number,
  ): Promise<Array<{ params: Record<string, number>; aggregate: DslBacktestAggregate }>> {
    const keys = Object.keys(dsl.parameters);
    const base = defaultParameterValues(dsl);

    if (samplingStrategy === 'default' || keys.length === 0) {
      const aggregate = await this.runBacktest(dsl, base, period);
      return [{ params: base, aggregate }];
    }

    const count = Math.max(1, Math.min(sampleCount ?? 8, 32));
    const results: Array<{ params: Record<string, number>; aggregate: DslBacktestAggregate }> = [];
    const hasV2 = keys.some((k) => isParameterRangeV2(dsl.parameters[k]));

    // Phase 6.7b: 明示 range の全組み合わせ（500 通り超は enumerate 内で例外）
    if (samplingStrategy === 'grid' && hasV2) {
      const grid = enumerateParameterGrid(dsl);
      for (const g of grid) {
        const merged = { ...base, ...g };
        const aggregate = await this.runBacktest(dsl, merged, period);
        results.push({ params: merged, aggregate });
      }
      return results;
    }

    if (samplingStrategy === 'random') {
      for (let i = 0; i < count; i++) {
        const params: Record<string, number> = { ...base };
        for (const k of keys) {
          const def = dsl.parameters[k];
          if (isParameterRangeV2(def)) {
            const vals = valuesForParameterField(k, def);
            const pick = vals[Math.floor(Math.random() * Math.max(1, vals.length))] ?? def.default;
            params[k] = pick;
          } else if (isLegacyParameterDef(def)) {
            const [lo, hi] = def.range;
            const t = Math.random();
            const v = def.type === 'int' ? Math.round(lo + t * (hi - lo)) : lo + t * (hi - lo);
            params[k] = v;
          }
        }
        const aggregate = await this.runBacktest(dsl, params, period);
        results.push({ params, aggregate });
      }
      return results;
    }

    // grid レガシー（v2 なし）: 最初の2パラメータを二等分グリッド
    if (keys.length === 1) {
      const k0 = keys[0];
      const def0 = dsl.parameters[k0];
      if (!isLegacyParameterDef(def0)) {
        const aggregate = await this.runBacktest(dsl, base, period);
        return [{ params: base, aggregate }];
      }
      const steps = Math.min(count, 5);
      for (let i = 0; i < steps; i++) {
        const t = i / (steps - 1 || 1);
        const [lo, hi] = def0.range;
        const v = def0.type === 'int' ? Math.round(lo + t * (hi - lo)) : lo + t * (hi - lo);
        const params = { ...base, [k0]: v };
        const aggregate = await this.runBacktest(dsl, params, period);
        results.push({ params, aggregate });
      }
      return results;
    }

    const k0 = keys[0];
    const k1 = keys[1];
    const d0 = dsl.parameters[k0];
    const d1 = dsl.parameters[k1];
    if (!isLegacyParameterDef(d0) || !isLegacyParameterDef(d1)) {
      const aggregate = await this.runBacktest(dsl, base, period);
      return [{ params: base, aggregate }];
    }
    const n = Math.min(3, Math.ceil(Math.sqrt(count)));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const t0 = i / (n - 1 || 1);
        const t1 = j / (n - 1 || 1);
        const v0 = d0.type === 'int'
          ? Math.round(d0.range[0] + t0 * (d0.range[1] - d0.range[0]))
          : d0.range[0] + t0 * (d0.range[1] - d0.range[0]);
        const v1 = d1.type === 'int'
          ? Math.round(d1.range[0] + t1 * (d1.range[1] - d1.range[0]))
          : d1.range[0] + t1 * (d1.range[1] - d1.range[0]);
        const params = { ...base, [k0]: v0, [k1]: v1 };
        const aggregate = await this.runBacktest(dsl, params, period);
        results.push({ params, aggregate });
      }
    }
    return results;
  }
}
