/**
 * BacktesterAgent（Phase 4c Step D）
 *
 * 検証ツール群（WalkForward / MonteCarlo / BuyAndHold）を並列に実行し、
 * Phase 4b で取得済みのスクリーニング結果と合わせて統合レポート
 * （ConsolidatedValidationReport）を返す中位層オーケストレーター。
 *
 * 設計原則（仕様書 §4.8）:
 * - LLM を使わない純粋な TypeScript オーケストレーター
 * - Promise.allSettled による単位失敗許容（1 ツール失敗でも他は継続）
 * - 永続化は行わない（StatusManager 判定 + EdgeLedger 書き込みは上位の
 *   StrategistAgent の責務）
 * - `hypothesis.screeningResult` を screening フィールドに流用し、同じ
 *   backtestRunId を下位3ツールに伝搬させて BT 再走コストを避ける
 *
 * @see docs/design/phase_4c_specification.md §4.8
 */

import type {
    ConsolidatedValidationReport,
    EdgeHypothesis,
    ScreeningResult as Phase4bScreeningResult,
} from '../models/edgeHypothesis';
import type { ValidationTool, ValidationToolInput, ValidationToolResult } from '../validation/tools/types';
import {
    walkForwardTool as defaultWalkForwardTool,
    monteCarloTool as defaultMonteCarloTool,
    buyAndHoldTool as defaultBuyAndHoldTool,
} from '../validation/tools';

// ===========================================
// 依存の型
// ===========================================

export interface BacktesterAgentTools {
    walkForward: ValidationTool;
    monteCarlo: ValidationTool;
    buyAndHold: ValidationTool;
}

// ===========================================
// Agent 本体
// ===========================================

export class BacktesterAgent {
    constructor(
        private readonly tools: BacktesterAgentTools = {
            walkForward: defaultWalkForwardTool,
            monteCarlo: defaultMonteCarloTool,
            buyAndHold: defaultBuyAndHoldTool,
        },
    ) {}

    /**
     * 4ツール統合レポートを生成する。
     *
     * - screening: hypothesis.screeningResult（Phase 4b 成果物）を流用
     * - walkForward / monteCarlo / buyAndHold: `Promise.allSettled` で並列
     *
     * 戻り値の allPassed は 4 ツール全通過のときのみ true。screening が
     * 無い（Phase 4b を通過していない）場合は必ず false。
     */
    async runFullValidation(
        hypothesis: EdgeHypothesis,
        tradeNoteId: string,
        period: { start: string; end: string },
    ): Promise<ConsolidatedValidationReport> {
        const startedAt = new Date();

        const screening = toScreeningToolResult(hypothesis.screeningResult);

        const input: ValidationToolInput = {
            kind: 'hypothesis',
            hypothesis,
            tradeNoteId,
            period,
            backtestRunId: hypothesis.screeningResult?.backtestRunId,
        };

        const settled = await Promise.allSettled([
            this.tools.walkForward.execute(input),
            this.tools.monteCarlo.execute(input),
            this.tools.buyAndHold.execute(input),
        ]);

        const errors: string[] = [];
        const labels = ['walkForward', 'monteCarlo', 'buyAndHold'] as const;
        const toolResults: (ValidationToolResult | undefined)[] = settled.map((r, i) => {
            if (r.status === 'fulfilled') {
                if (!r.value.success && r.value.error) {
                    errors.push(`${labels[i]}: ${r.value.error}`);
                }
                return r.value;
            }
            const reasonMsg = r.reason instanceof Error ? r.reason.message : String(r.reason);
            errors.push(`${labels[i]}: ${reasonMsg}`);
            return undefined;
        });

        const [walkForward, monteCarlo, buyAndHold] = toolResults;

        const allTools: (ValidationToolResult | undefined)[] = [
            screening,
            walkForward,
            monteCarlo,
            buyAndHold,
        ];
        const passedCount = allTools.filter((r) => r?.passed === true).length;
        const totalCount = allTools.length;
        const allPassed = allTools.every((r) => r?.passed === true);

        const completedAt = new Date();

        return {
            hypothesisId: hypothesis.id,
            periodUsed: period,
            screening,
            walkForward,
            monteCarlo,
            buyAndHold,
            allPassed,
            passedCount,
            totalCount,
            startedAt: startedAt.toISOString(),
            completedAt: completedAt.toISOString(),
            totalDurationMs: completedAt.getTime() - startedAt.getTime(),
            errors,
        };
    }
}

// ===========================================
// ヘルパー
// ===========================================

/**
 * Phase 4b の screeningResult を ValidationToolResult 形式に変換する。
 * screening 情報がなければ undefined を返す（allPassed=false になる）。
 */
function toScreeningToolResult(
    sr: Phase4bScreeningResult | undefined,
): ValidationToolResult | undefined {
    if (!sr) return undefined;

    const winRatePct = (sr.metrics.winRate > 1 ? sr.metrics.winRate : sr.metrics.winRate * 100).toFixed(1);

    return {
        toolName: 'screening',
        success: true,
        passed: sr.passed,
        metrics: {
            pf: sr.metrics.pf,
            winRate: sr.metrics.winRate,
            tradeCount: sr.metrics.tradeCount,
        },
        interpretation: sr.passed
            ? `スクリーニング通過 (PF=${sr.metrics.pf.toFixed(2)}, 勝率=${winRatePct}%, トレード数=${sr.metrics.tradeCount})`
            : `スクリーニング棄却: ${(sr.reasons ?? []).join(', ')}`,
        durationMs: 0,
    };
}

export const backtesterAgent = new BacktesterAgent();
