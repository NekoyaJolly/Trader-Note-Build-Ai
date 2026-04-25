/**
 * StrategyBacktesterAgent（Phase 6.7b）
 *
 * Strategy Thinker のシナリオを StrategyDSL に落とし、DSLBacktestAdapter と
 * 検証3ツール（仮想実績=検証期間）で即時 BT する。
 *
 * @see docs/design/phase_6_7b_bt_layer.md
 */

import type { AITradeScenario } from '../models/tradePlan';
import { DSLBacktestAdapter, toDSLBacktestResult, type DSLBacktestResult } from '../strategy_dsl/DSLBacktestAdapter';
import type { StrategyDSL } from '../strategy_dsl/schema';
import { defaultParameterValues } from '../strategy_dsl/dslParameterUtils';
import { scenarioToStrategyDSL } from '../strategy_dsl/scenarioToStrategyDSL';
import {
  walkForwardTool as defaultWalkForward,
  monteCarloTool as defaultMonteCarlo,
  buyAndHoldTool as defaultBuyAndHold,
} from '../validation/tools';
import type { ValidationTool, ValidationToolResult } from '../validation/tools/types';

/** プラン生成から渡す市場コンテキスト */
export interface StrategyBacktesterMarketContext {
  symbol: string;
  timeframe: string;
}

export interface PerScenarioBacktestResult {
  scenario: AITradeScenario;
  dsl?: StrategyDSL;
  dslResult?: DSLBacktestResult;
  error?: string;
  skipped?: boolean;
  skipReason?: string;
  toolResults: ValidationToolResult[];
  /** 3ツールとも success かつ全て passed */
  passed: boolean;
  /** ツール解釈の連結（LLM 解釈は Phase 6.7c 以降） */
  strategistInterpretation: string;
  durationMs: number;
}

export interface StrategyBacktesterRunResult {
  scenarioResults: PerScenarioBacktestResult[];
  /** 全シナリオが passed のときのみ true（シナリオ 0 件は false） */
  overallPassed: boolean;
  period: { start: string; end: string };
  totalDurationMs: number;
}

export interface StrategyBacktesterOptions {
  /** 省略時: 直近 365 日 */
  period?: { start: string; end: string };
}

function defaultBacktestPeriod(): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end.getTime() - 365 * 24 * 60 * 60 * 1000);
  return {
    start: start.toISOString().split('T')[0]!,
    end: end.toISOString().split('T')[0]!,
  };
}

function toolsAllPassed(results: ValidationToolResult[]): boolean {
  return (
    results.length >= 3 &&
    results.every((r) => r.success && r.passed)
  );
}

function joinInterpretations(results: ValidationToolResult[]): string {
  return results
    .map((r) => r.interpretation ?? `${r.toolName}: passed=${r.passed}`)
    .join(' / ');
}

export class StrategyBacktesterAgent {
  constructor(
    private readonly adapter: DSLBacktestAdapter = new DSLBacktestAdapter(),
    private readonly tools: {
      walkForward: ValidationTool;
      monteCarlo: ValidationTool;
      buyAndHold: ValidationTool;
    } = {
      walkForward: defaultWalkForward,
      monteCarlo: defaultMonteCarlo,
      buyAndHold: defaultBuyAndHold,
    },
  ) {}

  /**
   * 各シナリオを直列に BT（API・Python 負荷を考慮して並列シナリオは行わない）
   */
  async run(
    scenarios: AITradeScenario[],
    context: StrategyBacktesterMarketContext,
    options: StrategyBacktesterOptions = {},
  ): Promise<StrategyBacktesterRunResult> {
    const tAll = Date.now();
    const period = options.period ?? defaultBacktestPeriod();
    const scenarioResults: PerScenarioBacktestResult[] = [];

    if (!scenarios.length) {
      return {
        scenarioResults: [],
        overallPassed: false,
        period,
        totalDurationMs: Date.now() - tAll,
      };
    }

    for (const scenario of scenarios) {
      const t0 = Date.now();
      let dsl: StrategyDSL | undefined;
      try {
        dsl = scenarioToStrategyDSL(scenario, {
          symbol: context.symbol,
          timeframe: context.timeframe,
        });
      } catch (err) {
        scenarioResults.push({
          scenario,
          error: err instanceof Error ? err.message : String(err),
          toolResults: [],
          passed: false,
          strategistInterpretation: 'DSL 変換失敗',
          durationMs: Date.now() - t0,
        });
        continue;
      }

      const params = defaultParameterValues(dsl);
      let aggregate;
      try {
        aggregate = await this.adapter.runBacktest(dsl, params, period);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[StrategyBacktester] BT 失敗 scenario=${scenario.id}: ${msg}`);
        scenarioResults.push({
          scenario,
          dsl,
          error: msg,
          toolResults: [],
          passed: false,
          strategistInterpretation: `バックテスト失敗: ${msg}`,
          durationMs: Date.now() - t0,
        });
        continue;
      }

      const dslResult = toDSLBacktestResult(aggregate, params);
      const input = {
        kind: 'strategy' as const,
        strategy: dsl,
        dslResult,
        period,
      };

      const settled = await Promise.allSettled([
        this.tools.walkForward.execute(input),
        this.tools.monteCarlo.execute(input),
        this.tools.buyAndHold.execute(input),
      ]);
      const labels = ['walkForward', 'monteCarlo', 'buyAndHold'] as const;
      const toolResults: ValidationToolResult[] = [];
      for (let i = 0; i < settled.length; i++) {
        const s = settled[i]!;
        if (s.status === 'fulfilled') {
          toolResults.push(s.value);
        } else {
          const err = s.reason instanceof Error ? s.reason.message : String(s.reason);
          toolResults.push({
            toolName: labels[i]!,
            success: false,
            passed: false,
            metrics: {},
            error: err,
            durationMs: 0,
          });
        }
      }

      const passed = toolsAllPassed(toolResults);
      scenarioResults.push({
        scenario,
        dsl,
        dslResult,
        toolResults,
        passed,
        strategistInterpretation: joinInterpretations(toolResults),
        durationMs: Date.now() - t0,
      });
    }

    const overallPassed = scenarioResults.length > 0 && scenarioResults.every((r) => r.passed);

    return {
      scenarioResults,
      overallPassed,
      period,
      totalDurationMs: Date.now() - tAll,
    };
  }
}

export const strategyBacktesterAgent = new StrategyBacktesterAgent();
