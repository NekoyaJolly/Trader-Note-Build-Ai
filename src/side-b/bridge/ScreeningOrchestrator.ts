/**
 * ScreeningOrchestrator（Phase 4b 縮小版）
 *
 * EdgeHypothesis に対して、Side-A BacktestService を使った
 * **事前スクリーニング**（粗いフィルタ）を実行する。
 *
 * 本格検証（WalkForward / MonteCarlo / BuyAndHold）は Phase 4c で実装される。
 * このフェーズでは `screening_passed` へのステータス昇格までを担う。
 *
 * フロー:
 *   1. unverified 仮説を取得
 *   2. MaterializationService で TradeNote に materialize
 *      （失敗なら 'not_testable'）
 *   3. Side-A BacktestService.execute + getResult で BT 実行
 *   4. StatusManager.canPromoteToScreeningPassed で判定
 *   5. EdgeLedger.recordScreeningResult でステータス遷移
 *
 * 設計原則:
 * - Side-A コードを一切変更しない（backtestService は外部 API として呼び出すのみ）
 * - best-effort: 1件の失敗が他仮説の検証を止めない
 * - 決定論的判定: LLM は使わない（判定は SCREENING_THRESHOLDS に従う）
 *
 * @see docs/design/phase_4b_specification.md セクション4.4
 */

import type { LensFeatureSnapshot } from '../lenses';
import type { EdgeHypothesis, ScreeningResult } from '../models/edgeHypothesis';
import { EdgeLedger } from '../ledger/EdgeLedger';
import { edgeLedger as defaultEdgeLedger } from '../ledger/EdgeLedger';
import { StatusManager, statusManager as defaultStatusManager } from '../ledger/statusManager';
import { MaterializationService } from './MaterializationService';
import { materializationService as defaultMaterializationService } from './MaterializationService';
import { MaterializationError } from './types';
import { backtestService as defaultBacktestService, type BacktestService } from '../../services/backtestService';

// ===========================================
// 型
// ===========================================

export interface ScreeningOrchestratorOptions {
    /** ATR / エントリー価格の取得元レンズスナップショット */
    lensSnapshot?: LensFeatureSnapshot;
    /** スクリーニング対象期間（既定: 直近1年） */
    period?: { start: string; end: string };
    /** マッチ閾値（Side-A BT の入力、既定 0.6） TODO(Phase 4c): 外部化 */
    matchThreshold?: number;
    /** unverified 以外のステータスに対しても強制実行する（テスト / 再スクリーニング用） */
    force?: boolean;
}

/**
 * スクリーニング1回分の結果（Orchestrator が呼び出し元に返す）
 */
export type ScreeningRunResult =
    | {
        hypothesisId: string;
        verdict: 'screening_passed';
        tradeNoteId: string;
        metrics: ScreeningResult['metrics'];
        backtestRunId: string;
    }
    | {
        hypothesisId: string;
        verdict: 'rejected';
        tradeNoteId: string;
        metrics: ScreeningResult['metrics'];
        backtestRunId: string;
        reasons: string[];
    }
    | {
        hypothesisId: string;
        verdict: 'not_testable';
        reason: string;
    };

// ===========================================
// ScreeningOrchestrator 本体
// ===========================================

export class ScreeningOrchestrator {
    constructor(
        private readonly materialization: MaterializationService = defaultMaterializationService,
        private readonly edgeLedger: EdgeLedger = defaultEdgeLedger,
        private readonly statusManager: StatusManager = defaultStatusManager,
        private readonly backtestService: BacktestService = defaultBacktestService,
    ) {}

    /**
     * 仮説に対して事前スクリーニングを実行する。
     *
     * 呼び出し前提:
     * - hypothesis.status === 'unverified'（force=true で回避可）
     * - hypothesis.symbols / timeframes が空でない
     *
     * 例外:
     * - 仮説が見つからない場合は Error を投げる（スケジューラーは個別にキャッチする）
     * - Side-A BT 実行で内部例外が起きた場合もそのまま投げる
     *   （呼び出し側がジョブレベルで個別対応）
     *
     * MaterializationError は内部で捕捉し、verdict='not_testable' で返す。
     */
    async runScreening(
        hypothesisId: string,
        options: ScreeningOrchestratorOptions = {},
    ): Promise<ScreeningRunResult> {
        const hypothesis = await this.edgeLedger.get(hypothesisId);
        if (!hypothesis) {
            throw new Error(`Hypothesis not found: ${hypothesisId}`);
        }

        if (!options.force && hypothesis.status !== 'unverified') {
            throw new Error(
                `Hypothesis ${hypothesisId} is not unverified (status=${hypothesis.status}). force=true で強制可能。`,
            );
        }

        const period = options.period ?? this.determineScreeningPeriod();
        const timeframe = hypothesis.timeframes[0] ?? '15m';
        const matchThreshold = options.matchThreshold ?? 0.6;

        // 1. Materialize
        let materialized;
        try {
            materialized = await this.materialization.materializeForValidation(hypothesis, {
                lensSnapshot: options.lensSnapshot,
            });
        } catch (error) {
            if (error instanceof MaterializationError) {
                const reason = error.reason;
                await this.edgeLedger.markNotTestable(hypothesisId, `Materialization失敗: ${reason}`);
                return { hypothesisId, verdict: 'not_testable', reason };
            }
            throw error;
        }

        const { tradeNoteId, stopLossPercent, takeProfitPercent, maxHoldingMinutes } = materialized;

        // 2. Side-A BacktestService で BT 実行
        const runId = await this.backtestService.execute({
            noteId: tradeNoteId,
            startDate: new Date(period.start),
            endDate: new Date(period.end),
            timeframe,
            matchThreshold,
            takeProfit: takeProfitPercent,
            stopLoss: stopLossPercent,
            maxHoldingMinutes,
        });

        // 3. 結果取得
        const summary = await this.backtestService.getResult(runId);
        if (!summary) {
            // runId が取得できたのに結果が無いのは Side-A 側の異常。not_testable 扱い。
            const reason = `BT 結果取得失敗 (runId=${runId})`;
            await this.edgeLedger.markNotTestable(hypothesisId, reason);
            return { hypothesisId, verdict: 'not_testable', reason };
        }

        const pf = summary.profitFactor ?? 0;
        const winRate = summary.winRate; // Side-A は 0-1 で返す
        const tradeCount = summary.setupCount;
        const metrics: ScreeningResult['metrics'] = { pf, winRate, tradeCount };

        // 4. 判定
        const check = this.statusManager.canPromoteToScreeningPassed(metrics);

        // 5. 記録
        const result: ScreeningResult = {
            executedAt: new Date().toISOString(),
            tradeNoteId,
            passed: check.ok,
            metrics,
            reasons: check.ok ? undefined : check.reasons,
            backtestRunId: runId,
        };

        await this.edgeLedger.recordScreeningResult(hypothesisId, result);

        if (check.ok) {
            return {
                hypothesisId,
                verdict: 'screening_passed',
                tradeNoteId,
                metrics,
                backtestRunId: runId,
            };
        }
        return {
            hypothesisId,
            verdict: 'rejected',
            tradeNoteId,
            metrics,
            backtestRunId: runId,
            reasons: check.reasons,
        };
    }

    /**
     * スクリーニング対象期間のデフォルト（直近1年）
     * ISO8601 日付文字列を返す。
     */
    private determineScreeningPeriod(): { start: string; end: string } {
        const end = new Date();
        const start = new Date(end);
        start.setFullYear(start.getFullYear() - 1);
        return {
            start: start.toISOString().split('T')[0],
            end: end.toISOString().split('T')[0],
        };
    }
}

/**
 * 既定シングルトン（依存性を注入する場合は new で別インスタンスを作ること）
 */
export const screeningOrchestrator = new ScreeningOrchestrator();
