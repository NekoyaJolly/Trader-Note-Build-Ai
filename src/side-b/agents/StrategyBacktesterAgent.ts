/**
 * StrategyBacktesterAgent (Critical-4 段階 2: analysis-engine 経由 + DB 永続化)
 *
 * Strategy Thinker のシナリオを StrategyDSL に落とし、analysis-engine の
 * `/v1/screening-backtest` で BT を実行 → 結果を `ScreeningBacktestRun` に永続化、
 * その後 WF/MC/BH 3 ツールに `screeningBacktestRunId` を渡して評価する。
 *
 * 設計原則 (§13 / §12):
 * - BT エンジンはアプリ全体で 1 つだけ (analysis-engine + backtesting.py)
 * - DSL → ノート schema 変換は本ファイルが責任 (dslToBacktestNotePayload)
 * - Phase 4c の WF/MC/BH と入力源を統一 (ScreeningBacktestRun.id 経由)
 * - DSLBacktestAdapter (TS 自前 BT) への直接依存を撤廃
 *
 * @see docs/design/critical_4_bt_unification.md §13 / 段階 2
 */

import type { AITradeScenario } from '../models/tradePlan';
import type { EdgeHypothesis } from '../models/edgeHypothesis';
import { dslToBacktestNotePayload } from '../strategy_dsl/dslToBacktestNotePayload';
import type { StrategyDSL } from '../strategy_dsl/schema';
import { defaultParameterValues } from '../strategy_dsl/dslParameterUtils';
import { scenarioToStrategyDSL } from '../strategy_dsl/scenarioToStrategyDSL';
import { normalizeCTraderSymbol } from '../../utils/symbolNormalization';
import { normalizeTimeframe } from '../constants/timeframes';
import {
    walkForwardTool as defaultWalkForward,
    monteCarloTool as defaultMonteCarlo,
    buyAndHoldTool as defaultBuyAndHold,
} from '../validation/tools';
import type {
    HypothesisValidationInput,
    ValidationTool,
    ValidationToolResult,
} from '../validation/tools/types';
import type { ScreeningBacktestRunRepository } from '../../backend/repositories/screeningBacktestRunRepository';
import { screeningBacktestRunRepository as defaultScreeningBacktestRepo } from '../../backend/repositories/screeningBacktestRunRepository';
import { runScreeningBacktest as defaultRunScreeningBacktest } from '../../backend/services/analysisEngineClient';

// ===========================================
// 型
// ===========================================

/** プラン生成から渡す市場コンテキスト */
export interface StrategyBacktesterMarketContext {
    symbol: string;
    timeframe: string;
}

/** 段階 2 で per-scenario 結果に追加された ScreeningBacktestRun 参照 */
export interface PerScenarioBacktestResult {
    scenario: AITradeScenario;
    dsl?: StrategyDSL;
    /** Critical-4 段階 2: BT 永続化 ID。analysis-engine が走った時のみセットされる */
    screeningBacktestRunId?: string;
    /** BT サマリ (analysis-engine response.summary を素直に持つ) */
    btSummary?: {
        pf: number;
        winRate: number;
        tradeCount: number;
    };
    error?: string;
    skipped?: boolean;
    skipReason?: string;
    toolResults: ValidationToolResult[];
    /** 3 ツールとも success かつ全 passed */
    passed: boolean;
    strategistInterpretation: string;
    durationMs: number;
}

export interface StrategyBacktesterRunResult {
    scenarioResults: PerScenarioBacktestResult[];
    overallPassed: boolean;
    period: { start: string; end: string };
    totalDurationMs: number;
}

export interface StrategyBacktesterOptions {
    /** 省略時: 直近 365 日 */
    period?: { start: string; end: string };
}

export type RunScreeningBacktestFn = typeof defaultRunScreeningBacktest;

// ===========================================
// ヘルパー
// ===========================================

function defaultBacktestPeriod(): { start: string; end: string } {
    const end = new Date();
    const start = new Date(end.getTime() - 365 * 24 * 60 * 60 * 1000);
    return {
        start: start.toISOString().split('T')[0],
        end: end.toISOString().split('T')[0],
    };
}

function toolsAllPassed(results: ValidationToolResult[]): boolean {
    return results.length >= 3 && results.every((r) => r.success && r.passed);
}

function joinInterpretations(results: ValidationToolResult[]): string {
    return results.map((r) => r.interpretation ?? `${r.toolName}: passed=${r.passed}`).join(' / ');
}

/**
 * シナリオから WF/MC/BH ツールが要求する EdgeHypothesis 形 (構造的) を組み立てる。
 *
 * 段階 1.7 以降 BuyAndHoldTool は `expectedDirection` 以外の hypothesis フィールドを
 * 直接読まず、symbol/timeframe/period も `ScreeningBacktestRun` 側から継承する。
 * 段階 3 で hypothesis フィールドへの依存を完全撤廃する予定。
 */
function buildHypothesisShape(
    scenario: AITradeScenario,
    dsl: StrategyDSL,
    context: StrategyBacktesterMarketContext,
): EdgeHypothesis {
    const now = new Date();
    return {
        id: scenario.id,
        statement: scenario.name ?? 'strategy backtest',
        category: 'other',
        conditions: [],
        expectedDirection: dsl.entry.direction,
        status: 'screening_passed',
        statusUpdatedAt: now,
        symbols: [context.symbol],
        timeframes: [context.timeframe],
        observationCount: 0,
        winCount: 0,
        lossCount: 0,
        breakevenCount: 0,
        totalPnlPips: 0,
        avgRR: 0,
        source: 'ai_generated',
        firstObservedAt: now,
        lastObservedAt: now,
        createdAt: now,
        updatedAt: now,
    };
}

// ===========================================
// Agent 本体
// ===========================================

export class StrategyBacktesterAgent {
    constructor(
        private readonly tools: {
            walkForward: ValidationTool;
            monteCarlo: ValidationTool;
            buyAndHold: ValidationTool;
        } = {
            walkForward: defaultWalkForward,
            monteCarlo: defaultMonteCarlo,
            buyAndHold: defaultBuyAndHold,
        },
        private readonly screeningBacktestRepo: ScreeningBacktestRunRepository = defaultScreeningBacktestRepo,
        private readonly runBacktest: RunScreeningBacktestFn = defaultRunScreeningBacktest,
    ) {}

    /**
     * 各シナリオを直列に BT (API・analysis-engine 負荷を考慮して並列シナリオは行わない)。
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
            scenarioResults.push(await this.runScenario(scenario, context, period, t0));
        }

        const overallPassed = scenarioResults.length > 0 && scenarioResults.every((r) => r.passed);
        return {
            scenarioResults,
            overallPassed,
            period,
            totalDurationMs: Date.now() - tAll,
        };
    }

    private async runScenario(
        scenario: AITradeScenario,
        context: StrategyBacktesterMarketContext,
        period: { start: string; end: string },
        startedAt: number,
    ): Promise<PerScenarioBacktestResult> {
        // symbol / timeframe を正規化 (ScreeningOrchestrator と同じ慣習)。
        // ScreeningBacktestRun に保存される値が screening 経路と plan 経路で
        // 同じ正規化規則を経ていれば、WF/MC/BH ツール側 (run.symbol/timeframe を
        // 信頼して再正規化しない) でも整合する。
        const symbol = normalizeCTraderSymbol(context.symbol);
        const timeframe = normalizeTimeframe(context.timeframe);

        // 1. シナリオ → DSL 変換 (DSL 内部の symbol/timeframe は元値のまま、
        //    analysis-engine への送信値だけ正規化済みを使う)
        let dsl: StrategyDSL;
        try {
            dsl = scenarioToStrategyDSL(scenario, {
                symbol: context.symbol,
                timeframe: context.timeframe,
            });
        } catch (err) {
            return {
                scenario,
                error: err instanceof Error ? err.message : String(err),
                toolResults: [],
                passed: false,
                strategistInterpretation: 'DSL 変換失敗',
                durationMs: Date.now() - startedAt,
            };
        }

        // 2. DSL → BacktestNotePayload (パラメータデフォルト解決込み)
        const params = defaultParameterValues(dsl);
        const notePayload = dslToBacktestNotePayload(dsl, params);

        // 3. analysis-engine 経由で BT 実行 (symbol/timeframe は正規化済みを送る)
        let btResponse;
        try {
            btResponse = await this.runBacktest({
                hypothesisId: scenario.id,
                symbol,
                timeframe,
                startDate: new Date(period.start).toISOString(),
                endDate: new Date(period.end).toISOString(),
                notePayload,
                config: { initialCapital: 10_000, leverage: 1, tradingCost: 0 },
            });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`[StrategyBacktester] analysis-engine BT 失敗 scenario=${scenario.id}: ${msg}`);
            return {
                scenario,
                dsl,
                error: msg,
                toolResults: [],
                passed: false,
                strategistInterpretation: `BT 失敗: ${msg}`,
                durationMs: Date.now() - startedAt,
            };
        }

        // 4. ScreeningBacktestRun に永続化 (正規化済み symbol/timeframe を保存、
        //    後段ツールが run.symbol/timeframe をそのまま OHLCV クエリに使える前提)
        const persisted = await this.screeningBacktestRepo.create({
            hypothesisId: scenario.id,
            symbol,
            timeframe,
            periodStart: new Date(period.start),
            periodEnd: new Date(period.end),
            notePayload,
            summary: btResponse.summary,
            trades: btResponse.trades,
            equity: btResponse.equity ?? null,
            engineVersion: btResponse.engineVersion,
        });

        // 5. WF/MC/BH を ScreeningBacktestRun.id 経由で実行 (Phase 4c と同じ統一経路)
        const input: HypothesisValidationInput = {
            kind: 'hypothesis',
            hypothesis: buildHypothesisShape(scenario, dsl, { symbol, timeframe }),
            period,
            screeningBacktestRunId: persisted.id,
        };

        const settled = await Promise.allSettled([
            this.tools.walkForward.execute(input),
            this.tools.monteCarlo.execute(input),
            this.tools.buyAndHold.execute(input),
        ]);
        const toolNames = [
            this.tools.walkForward.name,
            this.tools.monteCarlo.name,
            this.tools.buyAndHold.name,
        ] as const;
        const toolResults: ValidationToolResult[] = [];
        for (let i = 0; i < settled.length; i++) {
            const s = settled[i];
            if (s.status === 'fulfilled') {
                toolResults.push(s.value);
            } else {
                const err = s.reason instanceof Error ? s.reason.message : String(s.reason);
                toolResults.push({
                    toolName: toolNames[i],
                    success: false,
                    passed: false,
                    metrics: {},
                    error: err,
                    durationMs: 0,
                });
            }
        }

        const passed = toolsAllPassed(toolResults);
        return {
            scenario,
            dsl,
            screeningBacktestRunId: persisted.id,
            btSummary: {
                pf: btResponse.summary.pf,
                winRate: btResponse.summary.winRate,
                tradeCount: btResponse.summary.tradeCount,
            },
            toolResults,
            passed,
            strategistInterpretation: joinInterpretations(toolResults),
            durationMs: Date.now() - startedAt,
        };
    }
}

export const strategyBacktesterAgent = new StrategyBacktesterAgent();
