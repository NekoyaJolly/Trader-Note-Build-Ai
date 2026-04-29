/**
 * WalkForwardTool（Phase 4c Step C）
 *
 * Phase 4b の Side-A BacktestRun が記録したトレードイベントを Python
 * コンテナに送り、walk_forward.py で時間軸の IS/OOS 分割統計を計算する。
 *
 * 判定基準: overfitScore < VALIDATION_THRESHOLDS.walkForward.maxOverfitScore (既定 0.3)
 *
 * 本実装は「固定条件のトレード群を時間窓に切って安定性を見る」簡易版。
 * 真のパラメーター再学習型 Walk-Forward ではない（Side-B の仮説は
 * 固定条件のため再学習対象が無い）。
 *
 * @see docs/design/phase_4c_specification.md §4.5
 */

import { backtestService as defaultBacktestService, type BacktestService } from '../../../services/backtestService';
import { createDefaultPythonBridge, type PythonBridge } from '../python_bridge';
import { VALIDATION_THRESHOLDS } from '../../config/validationThresholds';
import type {
    HypothesisValidationInput,
    ValidationTool,
    ValidationToolInput,
    ValidationToolResult,
} from './types';
import { isStrategyValidationInput } from './types';

// ===========================================
// Python 出力の契約
// ===========================================

interface WalkForwardPythonOutput {
    overfitScore: number | null;
    avgInSampleWinRate: number | null;
    avgOutOfSampleWinRate: number | null;
    inSamplePF: number | null;
    outOfSamplePF: number | null;
    splitCount: number;
    totalTradeCount: number;
    windowsEvaluated: number;
}

function isWalkForwardOutput(o: unknown): o is WalkForwardPythonOutput {
    if (!o || typeof o !== 'object') return false;
    const r = o as Record<string, unknown>;
    return (
        (r.overfitScore === null || typeof r.overfitScore === 'number') &&
        typeof r.splitCount === 'number' &&
        typeof r.totalTradeCount === 'number' &&
        typeof r.windowsEvaluated === 'number'
    );
}

// ===========================================
// Tool 本体
// ===========================================

export interface WalkForwardToolConfig {
    /** 分割数（既定 4 = 8 サブ窓で IS/OOS ペア 4 組） */
    splitCount?: number;
    /** overfitScore の上限（省略時は VALIDATION_THRESHOLDS.walkForward.maxOverfitScore） */
    maxOverfitScore?: number;
    /** 最小トレード数（省略時は VALIDATION_THRESHOLDS.common.minTradeCount） */
    minTradeCount?: number;
    /** Python スクリプトのコンテナ内パス */
    scriptPath?: string;
    /** Python 実行タイムアウト(ms) */
    timeoutMs?: number;
}

export class WalkForwardTool implements ValidationTool {
    readonly name = 'walk_forward';
    readonly implementation = 'python_bridge' as const;
    readonly requiredInputs: readonly string[] = ['kind', 'hypothesis', 'backtestRunId', 'period'];

    private readonly splitCount: number;
    private readonly maxOverfitScore: number;
    private readonly minTradeCount: number;
    private readonly scriptPath: string;
    private readonly timeoutMs: number | undefined;

    constructor(
        private readonly pythonBridge: PythonBridge = createDefaultPythonBridge(),
        private readonly backtestService: BacktestService = defaultBacktestService,
        config: WalkForwardToolConfig = {},
    ) {
        this.splitCount = config.splitCount ?? 4;
        this.maxOverfitScore = config.maxOverfitScore ?? VALIDATION_THRESHOLDS.walkForward.maxOverfitScore;
        this.minTradeCount = config.minTradeCount ?? VALIDATION_THRESHOLDS.common.minTradeCount;
        this.scriptPath = config.scriptPath ?? '/app/walk_forward/walk_forward.py';
        this.timeoutMs = config.timeoutMs;
    }

    async execute(input: ValidationToolInput): Promise<ValidationToolResult> {
        if (isStrategyValidationInput(input)) {
            return this.runWalkForwardOnEvents(
                input.dslResult.events
                    .filter((e) => typeof e.pnl === 'number' && Number.isFinite(e.pnl))
                    .map((e) => ({ entryTime: e.entryTime, pnl: e.pnl })),
                input.period,
                Date.now(),
                {
                    executionModel: input.dslResult.executionModel,
                    executionConfigHash: input.dslResult.executionConfigHash,
                },
            );
        }
        return this.executeHypothesis(input, Date.now());
    }

    private async executeHypothesis(
        input: HypothesisValidationInput,
        start: number,
    ): Promise<ValidationToolResult> {
        if (!input.backtestRunId) {
            return this.fail('backtestRunId が未指定（Phase 4b screening 結果が必要）', start);
        }

        // 1. Side-A BT 結果からイベントを取得
        let summary;
        try {
            summary = await this.backtestService.getResult(input.backtestRunId);
        } catch (err) {
            return this.fail(`BT 結果取得失敗: ${err instanceof Error ? err.message : String(err)}`, start);
        }
        if (!summary) {
            return this.fail(`BT 結果が見つからない (runId=${input.backtestRunId})`, start);
        }

        const events = summary.events
            .filter((e) => typeof e.pnl === 'number' && Number.isFinite(e.pnl))
            .map((e) => ({ entryTime: e.entryTime, pnl: e.pnl as number }));

        return this.runWalkForwardOnEvents(events, input.period, start);
    }

    private async runWalkForwardOnEvents(
        events: Array<{ entryTime: string; pnl: number }>,
        period: { start: string; end: string },
        start: number,
        executionMetrics: Record<string, string> = {},
    ): Promise<ValidationToolResult> {

        if (events.length < this.minTradeCount) {
            return {
                toolName: this.name,
                success: true,
                passed: false,
                metrics: { tradeCount: events.length, reason: 'insufficient_trades', ...executionMetrics },
                interpretation: `トレード数不足: ${events.length} < ${this.minTradeCount}`,
                durationMs: Date.now() - start,
            };
        }

        // 2. Python で WF 計算
        const pyResult = await this.pythonBridge.execute({
            scriptPath: this.scriptPath,
            input: {
                events,
                period,
                splitCount: this.splitCount,
            },
            timeoutMs: this.timeoutMs,
        });

        if (!pyResult.success) {
            return this.fail(`Python 実行失敗: ${pyResult.error ?? 'unknown'}`, start);
        }
        if (!isWalkForwardOutput(pyResult.output)) {
            return this.fail(`Python 出力形式が不正: ${JSON.stringify(pyResult.output)}`, start);
        }

        const out = pyResult.output;

        // 3. windowsEvaluated=0 は統計不能
        if (out.windowsEvaluated === 0 || out.overfitScore === null) {
            return {
                toolName: this.name,
                success: true,
                passed: false,
                metrics: {
                    tradeCount: out.totalTradeCount,
                    windowsEvaluated: out.windowsEvaluated,
                    splitCount: out.splitCount,
                    reason: 'insufficient_windows',
                    ...executionMetrics,
                },
                interpretation: '有効な IS/OOS 窓が得られなかった（トレード分布が偏りすぎ）',
                durationMs: Date.now() - start,
            };
        }

        const passed = out.overfitScore < this.maxOverfitScore;

        return {
            toolName: this.name,
            success: true,
            passed,
            metrics: {
                overfitScore: out.overfitScore,
                avgInSampleWinRate: nz(out.avgInSampleWinRate),
                avgOutOfSampleWinRate: nz(out.avgOutOfSampleWinRate),
                inSamplePF: nz(out.inSamplePF),
                outOfSamplePF: nz(out.outOfSamplePF),
                splitCount: out.splitCount,
                tradeCount: out.totalTradeCount,
                windowsEvaluated: out.windowsEvaluated,
                ...executionMetrics,
            },
            interpretation: passed
                ? `overfitScore=${out.overfitScore.toFixed(3)} < ${this.maxOverfitScore}（IS/OOS 勝率の乖離が許容内）`
                : `overfitScore=${out.overfitScore.toFixed(3)} >= ${this.maxOverfitScore}（IS 勝率と OOS 勝率が乖離、過学習の疑い）`,
            durationMs: Date.now() - start,
        };
    }

    async isAvailable(): Promise<boolean> {
        try {
            return await this.pythonBridge.healthCheck();
        } catch {
            return false;
        }
    }

    private fail(reason: string, start: number): ValidationToolResult {
        return {
            toolName: this.name,
            success: false,
            passed: false,
            metrics: {},
            error: reason,
            durationMs: Date.now() - start,
        };
    }
}

/** null → 0 正規化（metrics は数値限定のため） */
function nz(v: number | null): number {
    return v ?? 0;
}

export const walkForwardTool = new WalkForwardTool();
