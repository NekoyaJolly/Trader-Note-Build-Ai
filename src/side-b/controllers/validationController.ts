/**
 * Phase 4c/4d: 仮説検証 API コントローラー
 *
 * エンドポイント:
 * - GET  /api/side-b/hypotheses                         (Phase 4d Step 3)
 *     仮説一覧をフィルタ・検索・ソート・ページネーションで取得
 * - GET  /api/side-b/hypotheses/:id                     (Phase 4d Step 4)
 *     個別仮説を取得
 * - GET  /api/side-b/hypotheses/:id/validation-history  (Phase 4d Step 4)
 *     screening / full_validation の検証履歴エントリ配列
 * - POST /api/side-b/hypotheses/:id/validate            (Phase 4c)
 *     手動で本格検証（StrategistAgent.validate）を走らせる
 * - GET  /api/side-b/hypotheses/:id/validation-status   (Phase 4c)
 *     仮説の現在の検証ステータスとレポートを返す
 * - GET  /api/side-b/hypotheses/pending-validation      (Phase 4c)
 *     screening_passed 状態の仮説一覧（検証待ち）を返す
 *
 * @see docs/design/phase_4c_specification.md §4.13
 * @see docs/design/phase_4d_specification.md §4.2 §4.3
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
    type ScreeningResult,
    type ConsolidatedValidationReport,
} from '../models/edgeHypothesis';

// ===========================================
// Phase 4d: validation-history のエントリ型
// ===========================================

/**
 * 仮説の検証履歴エントリ。
 *
 * 現在の EdgeHypothesis には screeningResult と fullValidationReport が
 * それぞれ最大 1 件しか格納されないため実質は 0〜2 件の配列だが、
 * UI 側は配列走査で扱うことで Phase 5+ の履歴化拡張に備える。
 */
export type ValidationHistoryEntry =
    | {
        type: 'screening';
        /** ISO8601 */
        executedAt: string;
        passed: boolean;
        result: ScreeningResult;
    }
    | {
        type: 'full_validation';
        /** ISO8601 */
        executedAt: string;
        passed: boolean;
        report: ConsolidatedValidationReport;
    };

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
     * GET /api/side-b/hypotheses/:id
     *
     * 個別仮説の取得。詳細ページ（仕様書 §4.3）で使用。
     * レスポンスは `{ success, hypothesis }` の形式で、EdgeHypothesis を
     * そのまま返す（Date は JSON 化で ISO8601 文字列になる）。
     */
    getHypothesis = async (req: Request, res: Response): Promise<void> => {
        const { id } = req.params;
        if (!id) {
            res.status(400).json({ error: 'id は必須です' });
            return;
        }
        try {
            const hypothesis = await this.edgeLedger.get(id);
            if (!hypothesis) {
                res.status(404).json({
                    success: false,
                    error: `Hypothesis not found: ${id}`,
                });
                return;
            }
            res.json({ success: true, hypothesis });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error('[ValidationController] getHypothesis 失敗:', err);
            res.status(500).json({ success: false, error: message });
        }
    };

    /**
     * GET /api/side-b/hypotheses/:id/validation-history
     *
     * 仮説に対して記録されている検証履歴を新しい順で返す。
     *
     * 現在の情報源:
     *   - screeningResult (Phase 4b 縮小版、1 仮説 1 件)
     *   - fullValidationReport (Phase 4c で書き込み、実データは
     *     StrategistAgent.validate が実行された後のみ存在)
     *
     * 将来 Phase 5+ で複数スクリーニング履歴や複数フル検証履歴を持つように
     * なった際は、ここを配列走査に変える前提で拡張可能な形にしている。
     */
    getValidationHistory = async (req: Request, res: Response): Promise<void> => {
        const { id } = req.params;
        if (!id) {
            res.status(400).json({ error: 'id は必須です' });
            return;
        }
        try {
            const hypothesis = await this.edgeLedger.get(id);
            if (!hypothesis) {
                res.status(404).json({
                    success: false,
                    error: `Hypothesis not found: ${id}`,
                });
                return;
            }

            const history: ValidationHistoryEntry[] = [];

            if (hypothesis.screeningResult) {
                history.push({
                    type: 'screening',
                    executedAt: hypothesis.screeningResult.executedAt,
                    passed: hypothesis.screeningResult.passed,
                    result: hypothesis.screeningResult,
                });
            }

            if (hypothesis.fullValidationReport) {
                history.push({
                    type: 'full_validation',
                    executedAt: hypothesis.fullValidationReport.completedAt,
                    passed: hypothesis.fullValidationReport.allPassed,
                    report: hypothesis.fullValidationReport,
                });
            }

            // 新しい順にソート
            history.sort(
                (a, b) =>
                    new Date(b.executedAt).getTime() - new Date(a.executedAt).getTime(),
            );

            res.json({ success: true, history });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error('[ValidationController] getValidationHistory 失敗:', err);
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
