/**
 * Phase 4c/4d: 仮説検証 API コントローラー
 *
 * エンドポイント:
 * - GET  /api/side-b/hypotheses                 (Phase 4d Step 3)
 *     仮説一覧をフィルタ・検索・ソート・ページネーションで取得
 * - POST /api/side-b/hypotheses/:id/validate    (Phase 4c)
 *     手動で本格検証（StrategistAgent.validate）を走らせる
 * - GET  /api/side-b/hypotheses/:id/validation-status  (Phase 4c)
 *     仮説の現在の検証ステータスとレポートを返す
 * - GET  /api/side-b/hypotheses/pending-validation     (Phase 4c)
 *     screening_passed 状態の仮説一覧（検証待ち）を返す
 *
 * @see docs/design/phase_4c_specification.md §4.13
 * @see docs/design/phase_4d_specification.md §4.2
 */

import type { Request, Response } from 'express';
import {
    edgeLedger as defaultEdgeLedger,
    type EdgeLedger,
    type EdgeFindSortKey,
} from '../ledger/EdgeLedger';
import { strategistAgent as defaultStrategistAgent, type StrategistAgent } from '../agents/StrategistAgent';
import {
    EDGE_STATUSES,
    EDGE_CATEGORIES,
    EDGE_SOURCES,
    type EdgeStatus,
    type EdgeCategory,
    type EdgeSource,
} from '../models/edgeHypothesis';

// クエリパラメーター解釈用の小ユーティリティ群
// ===========================================

/**
 * Express の query は `string | string[] | undefined` の他に
 * ParsedQs も取り得るが、このコントローラーは配列 or 単一文字列のみ扱う。
 * 未知形式は undefined 扱いで無視する（検証用途で例外は立てない）。
 */
function toStringArray(raw: unknown): string[] | undefined {
    if (raw === undefined || raw === null) return undefined;
    if (Array.isArray(raw)) {
        const arr = raw
            .filter((v): v is string => typeof v === 'string')
            .flatMap((v) => v.split(',').map((s) => s.trim()).filter(Boolean));
        return arr.length > 0 ? arr : undefined;
    }
    if (typeof raw === 'string') {
        const arr = raw.split(',').map((s) => s.trim()).filter(Boolean);
        return arr.length > 0 ? arr : undefined;
    }
    return undefined;
}

function toPositiveInt(raw: unknown, fallback: number): number {
    if (typeof raw !== 'string') return fallback;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return parsed;
}

function filterByEnum<T extends string>(values: string[] | undefined, allowed: readonly T[]): T[] | undefined {
    if (!values) return undefined;
    const filtered = values.filter((v): v is T => (allowed as readonly string[]).includes(v));
    return filtered.length > 0 ? filtered : undefined;
}

const SORT_KEYS_ALLOWED: EdgeFindSortKey[] = ['newest', 'oldest', 'observation'];
function toSortKey(raw: unknown): EdgeFindSortKey {
    if (typeof raw !== 'string') return 'newest';
    return SORT_KEYS_ALLOWED.includes(raw as EdgeFindSortKey)
        ? (raw as EdgeFindSortKey)
        : 'newest';
}

// ===========================================
// Controller 本体
// ===========================================

export class ValidationController {
    constructor(
        private readonly edgeLedger: EdgeLedger = defaultEdgeLedger,
        private readonly strategist: StrategistAgent = defaultStrategistAgent,
    ) {}

    /**
     * GET /api/side-b/hypotheses
     *
     * フィルタ / 検索 / ソート / ページネーションに対応した仮説一覧取得。
     *
     * クエリパラメーター:
     *   status=unverified,confirmed   - カンマ区切り or 繰り返し。未知値は無視
     *   category=time,volatility
     *   source=ai_generated
     *   symbol=XAU/USD,EUR/USD        - 仮説が指定シンボルのいずれかを持てばヒット
     *   search=ロンドン              - statement への部分一致（大文字小文字無視）
     *   sortBy=newest|oldest|observation （既定 newest、未知値は newest にフォールバック）
     *   page=1                        - 1-based
     *   limit=20                      - 既定 20、上限 100
     */
    listHypotheses = async (req: Request, res: Response): Promise<void> => {
        const statuses = filterByEnum<EdgeStatus>(toStringArray(req.query.status), EDGE_STATUSES);
        const categories = filterByEnum<EdgeCategory>(
            toStringArray(req.query.category),
            EDGE_CATEGORIES,
        );
        const sources = filterByEnum<EdgeSource>(toStringArray(req.query.source), EDGE_SOURCES);
        const symbols = toStringArray(req.query.symbol);
        const search = typeof req.query.search === 'string' ? req.query.search : undefined;
        const sortBy = toSortKey(req.query.sortBy);
        const page = toPositiveInt(req.query.page, 1);
        const limit = toPositiveInt(req.query.limit, 20);

        try {
            const result = await this.edgeLedger.find({
                statuses,
                categories,
                sources,
                symbols,
                search,
                sortBy,
                page,
                limit,
            });
            res.json({
                success: true,
                total: result.total,
                page: result.page,
                limit: result.limit,
                hypotheses: result.hypotheses,
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error('[ValidationController] listHypotheses 失敗:', err);
            res.status(500).json({ success: false, error: message });
        }
    };

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
