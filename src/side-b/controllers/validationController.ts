/**
 * Phase 4c: 仮説検証 API コントローラー
 *
 * エンドポイント:
 * - POST /api/side-b/hypotheses/:id/validate
 *     手動で本格検証（StrategistAgent.validate）を走らせる
 * - GET  /api/side-b/hypotheses/:id/validation-status
 *     仮説の現在の検証ステータスとレポートを返す
 * - GET  /api/side-b/hypotheses/pending-validation
 *     screening_passed 状態の仮説一覧（検証待ち）を返す
 *
 * @see docs/design/phase_4c_specification.md §4.13
 */

import type { Request, Response } from 'express';
import { edgeLedger as defaultEdgeLedger, type EdgeLedger } from '../ledger/EdgeLedger';
import { strategistAgent as defaultStrategistAgent, type StrategistAgent } from '../agents/StrategistAgent';

// ===========================================
// Controller 本体
// ===========================================

export class ValidationController {
    constructor(
        private readonly edgeLedger: EdgeLedger = defaultEdgeLedger,
        private readonly strategist: StrategistAgent = defaultStrategistAgent,
    ) {}

    /**
     * POST /api/side-b/hypotheses/:id/validate
     *
     * スケジューラー待ちせず即時に検証を走らせる。
     * 長時間（Python + LLM でトータル 10-30 秒）かかる可能性あり、
     * タイムアウトは Express 側のデフォルトに従う。
     */
    validate = async (req: Request, res: Response): Promise<void> => {
        const { id } = req.params;
        if (!id) {
            res.status(400).json({ error: 'id は必須です' });
            return;
        }

        try {
            const verdict = await this.strategist.validate(id);
            res.json({
                success: true,
                verdict: verdict.verdict,
                hypothesisId: verdict.hypothesisId,
                baseCriteriaReasons: verdict.baseCriteriaReasons,
                report: verdict.report,
                interpretation: verdict.interpretation,
                actionableInsights: verdict.actionableInsights,
                decidedAt: verdict.decidedAt,
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            // 仮説未発見は 404、それ以外は 500
            if (/not found/i.test(message)) {
                res.status(404).json({ success: false, error: message });
                return;
            }
            console.error('[ValidationController] validate 失敗:', err);
            res.status(500).json({ success: false, error: message });
        }
    };

    /**
     * GET /api/side-b/hypotheses/:id/validation-status
     *
     * 現在の検証ステータスと既存レポートを返す。
     * 検証中(testing)・検証済(confirmed/rejected)・未検証(unverified/screening_passed)
     * を区別できる情報を返す。
     */
    getValidationStatus = async (req: Request, res: Response): Promise<void> => {
        const { id } = req.params;
        if (!id) {
            res.status(400).json({ error: 'id は必須です' });
            return;
        }

        try {
            const hypothesis = await this.edgeLedger.get(id);
            if (!hypothesis) {
                res.status(404).json({ success: false, error: `Hypothesis not found: ${id}` });
                return;
            }

            res.json({
                success: true,
                hypothesisId: hypothesis.id,
                status: hypothesis.status,
                statusUpdatedAt: hypothesis.statusUpdatedAt,
                statusNote: hypothesis.statusNote,
                lastTestedAt: hypothesis.lastTestedAt,
                screeningResult: hypothesis.screeningResult,
                fullValidationReport: hypothesis.fullValidationReport,
                confirmationInterpretation: hypothesis.confirmationInterpretation,
                rejectionInterpretation: hypothesis.rejectionInterpretation,
                actionableInsights: hypothesis.actionableInsights ?? [],
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error('[ValidationController] getValidationStatus 失敗:', err);
            res.status(500).json({ success: false, error: message });
        }
    };

    /**
     * GET /api/side-b/hypotheses/pending-validation
     *
     * screening_passed 状態の仮説一覧（本格検証待ち）を返す。
     * UI の待ち行列表示用。
     */
    listPendingValidation = async (_req: Request, res: Response): Promise<void> => {
        try {
            const items = await this.edgeLedger.findByStatus('screening_passed');
            res.json({
                success: true,
                total: items.length,
                hypotheses: items.map((h) => ({
                    id: h.id,
                    statement: h.statement,
                    category: h.category,
                    expectedDirection: h.expectedDirection,
                    symbols: h.symbols,
                    timeframes: h.timeframes,
                    statusUpdatedAt: h.statusUpdatedAt,
                    screeningResult: h.screeningResult,
                })),
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error('[ValidationController] listPendingValidation 失敗:', err);
            res.status(500).json({ success: false, error: message });
        }
    };
}

export const validationController = new ValidationController();
