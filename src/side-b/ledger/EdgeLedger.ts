/**
 * EdgeLedger — エッジ仮説台帳（Phase 4a）
 *
 * 責務:
 * - EdgeHypothesis の CRUD
 * - ステータス遷移（unverified/testing/confirmed/stale/rejected）
 * - 観測結果の累積記録
 * - LensFeatureSnapshot に対する条件マッチング検索
 *
 * 設計思想:
 * - Phase 4b の EdgeValidator が呼ぶ `markConfirmed` はこの段階で実装しておく
 *   （Phase 4a 中は呼び出し側を配線しない）
 * - Prisma クライアントを直接使う（aiNoteRepository のパターン踏襲）
 *
 * @see docs/design/phase_4_specification.md セクション4.2
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '../../backend/db/client';
import type {
    EdgeHypothesis,
    EdgeStatus,
    EdgeCategory,
    EdgeSource,
    MachineReadableCondition,
    BacktestSummary,
    WalkForwardSummary,
    CreateEdgeHypothesisInput,
    ScreeningResult,
    ConsolidatedValidationReport,
} from '../models/edgeHypothesis';
import type { LensFeatureSnapshot } from '../lenses';
import { evaluateConditions } from './conditionMatcher';
import type { EdgeLedgerStats, ObservationInput } from './types';
import { fromPrismaJsonValue, toPrismaJsonValue } from '../../utils/prismaJson';

type PrismaEdge = Awaited<ReturnType<typeof prisma.edgeHypothesis.findFirst>> & object;

// ===========================================
// Phase 4d: find() 用の型
// ===========================================

/**
 * ソートキー。
 *
 * NOTE: 仕様書 §4.2 には「確信度順」も挙がっているが、EdgeHypothesis 本体に
 * confidence スコアが存在しないため、Phase 4d MVP では意図的に未実装とする。
 * 将来的に overallConfidenceScore 等のスコア設計が決まった段階で
 * 'confidence' を追加する。
 */
export type EdgeFindSortKey = 'newest' | 'oldest' | 'observation';

export interface EdgeFindOptions {
    /** status のマルチ選択（OR 結合）。未指定時は全ステータス。 */
    statuses?: EdgeStatus[];
    /** category のマルチ選択（OR 結合）。 */
    categories?: EdgeCategory[];
    /** source のマルチ選択（OR 結合）。 */
    sources?: EdgeSource[];
    /** symbols のマルチ選択（仮説が指定シンボルのいずれかを持てばヒット）。 */
    symbols?: string[];
    /** statement への大文字小文字無視の部分一致。 */
    search?: string;
    /** ソート順。既定は 'newest'。 */
    sortBy?: EdgeFindSortKey;
    /** 1-based ページ番号。既定 1。 */
    page?: number;
    /** 1 ページ当たりの件数。既定 20、上限 100。 */
    limit?: number;
}

export interface EdgeFindResult {
    hypotheses: EdgeHypothesis[];
    /** フィルタ適用後の総件数（ページネーション前） */
    total: number;
    /** 実際に使われた page（正規化済み） */
    page: number;
    /** 実際に使われた limit（clamp 済み） */
    limit: number;
}

// ===========================================
// EdgeLedger 本体
// ===========================================

export class EdgeLedger {
    // --- CRUD ---

    async create(input: CreateEdgeHypothesisInput): Promise<EdgeHypothesis> {
        const now = new Date();
        const created = await prisma.edgeHypothesis.create({
            data: {
                statement: input.statement,
                category: input.category,
                conditions: toPrismaJsonValue(input.conditions),
                expectedDirection: input.expectedDirection,
                status: input.status,
                statusNote: input.statusNote,
                symbols: input.symbols,
                timeframes: input.timeframes,
                observationCount: input.observationCount,
                winCount: input.winCount,
                lossCount: input.lossCount,
                breakevenCount: input.breakevenCount,
                totalPnlPips: input.totalPnlPips,
                avgRR: input.avgRR,
                backtestResults: input.backtestResults
                    ? toPrismaJsonValue(input.backtestResults)
                    : undefined,
                walkForwardResults: input.walkForwardResults
                    ? toPrismaJsonValue(input.walkForwardResults)
                    : undefined,
                source: input.source,
                lensRelevance: input.lensRelevance
                    ? toPrismaJsonValue(input.lensRelevance)
                    : undefined,
                firstObservedAt: input.firstObservedAt ?? now,
                lastObservedAt: input.firstObservedAt ?? now,
                lastTestedAt: input.lastTestedAt,
                parentIds: input.parentIds ?? [],
                relatedNoteIds: input.relatedNoteIds ?? [],
                // Phase 4b
                defaultRiskManagement: input.defaultRiskManagement
                    ? toPrismaJsonValue(input.defaultRiskManagement)
                    : undefined,
                materializedTradeNoteIds: input.materializedTradeNoteIds ?? [],
                invalidationConditions: input.invalidationConditions
                    ? toPrismaJsonValue(input.invalidationConditions)
                    : undefined,
                confirmationNote: input.confirmationNote,
                screeningResult: input.screeningResult
                    ? toPrismaJsonValue(input.screeningResult)
                    : undefined,
                fullValidationReport: input.fullValidationReport
                    ? toPrismaJsonValue(input.fullValidationReport)
                    : undefined,
                confirmationInterpretation: input.confirmationInterpretation,
                rejectionInterpretation: input.rejectionInterpretation,
                actionableInsights: input.actionableInsights ?? [],
            },
        });
        return mapPrismaToEdgeHypothesis(created);
    }

    async get(id: string): Promise<EdgeHypothesis | null> {
        const row = await prisma.edgeHypothesis.findUnique({ where: { id } });
        return row ? mapPrismaToEdgeHypothesis(row) : null;
    }

    async update(id: string, patch: Partial<EdgeHypothesis>): Promise<EdgeHypothesis> {
        const data: Prisma.EdgeHypothesisUpdateInput = {};

        if (patch.statement !== undefined) data.statement = patch.statement;
        if (patch.category !== undefined) data.category = patch.category;
        if (patch.conditions !== undefined) {
            data.conditions = toPrismaJsonValue(patch.conditions);
        }
        if (patch.expectedDirection !== undefined) data.expectedDirection = patch.expectedDirection;
        if (patch.status !== undefined) {
            data.status = patch.status;
            data.statusUpdatedAt = new Date();
        }
        if (patch.statusNote !== undefined) data.statusNote = patch.statusNote;
        if (patch.symbols !== undefined) data.symbols = { set: patch.symbols };
        if (patch.timeframes !== undefined) data.timeframes = { set: patch.timeframes };
        if (patch.observationCount !== undefined) data.observationCount = patch.observationCount;
        if (patch.winCount !== undefined) data.winCount = patch.winCount;
        if (patch.lossCount !== undefined) data.lossCount = patch.lossCount;
        if (patch.breakevenCount !== undefined) data.breakevenCount = patch.breakevenCount;
        if (patch.totalPnlPips !== undefined) data.totalPnlPips = patch.totalPnlPips;
        if (patch.avgRR !== undefined) data.avgRR = patch.avgRR;
        if (patch.backtestResults !== undefined) {
            data.backtestResults = toPrismaJsonValue(patch.backtestResults);
        }
        if (patch.walkForwardResults !== undefined) {
            data.walkForwardResults = toPrismaJsonValue(patch.walkForwardResults);
        }
        if (patch.source !== undefined) data.source = patch.source;
        if (patch.lensRelevance !== undefined) {
            data.lensRelevance = patch.lensRelevance;
        }
        if (patch.lastObservedAt !== undefined) data.lastObservedAt = patch.lastObservedAt;
        if (patch.lastTestedAt !== undefined) data.lastTestedAt = patch.lastTestedAt;
        if (patch.parentIds !== undefined) data.parentIds = { set: patch.parentIds };
        if (patch.relatedNoteIds !== undefined) data.relatedNoteIds = { set: patch.relatedNoteIds };
        // Phase 4b
        if (patch.defaultRiskManagement !== undefined) {
            data.defaultRiskManagement = toPrismaJsonValue(patch.defaultRiskManagement);
        }
        if (patch.materializedTradeNoteIds !== undefined) {
            data.materializedTradeNoteIds = { set: patch.materializedTradeNoteIds };
        }
        if (patch.invalidationConditions !== undefined) {
            data.invalidationConditions = toPrismaJsonValue(patch.invalidationConditions);
        }
        if (patch.confirmationNote !== undefined) data.confirmationNote = patch.confirmationNote;
        if (patch.screeningResult !== undefined) {
            data.screeningResult = toPrismaJsonValue(patch.screeningResult);
        }
        if (patch.fullValidationReport !== undefined) {
            data.fullValidationReport = toPrismaJsonValue(patch.fullValidationReport);
        }
        if (patch.confirmationInterpretation !== undefined) {
            data.confirmationInterpretation = patch.confirmationInterpretation;
        }
        if (patch.rejectionInterpretation !== undefined) {
            data.rejectionInterpretation = patch.rejectionInterpretation;
        }
        if (patch.actionableInsights !== undefined) {
            data.actionableInsights = { set: patch.actionableInsights };
        }

        const updated = await prisma.edgeHypothesis.update({
            where: { id },
            data,
        });
        return mapPrismaToEdgeHypothesis(updated);
    }

    async delete(id: string): Promise<void> {
        await prisma.edgeHypothesis.delete({ where: { id } });
    }

    // --- 検索 ---

    async findByStatus(status: EdgeStatus): Promise<EdgeHypothesis[]> {
        const rows = await prisma.edgeHypothesis.findMany({
            where: { status },
            orderBy: { createdAt: 'desc' },
        });
        return rows.map(mapPrismaToEdgeHypothesis);
    }

    /**
     * Phase 4d: 直近で confirmed / rejected に遷移した仮説（検証完了扱い）。
     *
     * @param hours さかのぼる時間（既定 24）
     */
    async findRecentlyValidated(hours: number): Promise<EdgeHypothesis[]> {
        const h = Math.max(1, Math.min(168, hours));
        const since = new Date(Date.now() - h * 3600 * 1000);
        const rows = await prisma.edgeHypothesis.findMany({
            where: {
                status: { in: ['confirmed', 'rejected'] },
                statusUpdatedAt: { gte: since },
            },
            orderBy: { statusUpdatedAt: 'desc' },
        });
        return rows.map(mapPrismaToEdgeHypothesis);
    }

    /**
     * Phase 4d: ステータス別に最新 N 件（ダッシュボードの recent リスト用）
     */
    async findLatestByStatus(
        status: 'confirmed' | 'rejected',
        limit: number,
    ): Promise<EdgeHypothesis[]> {
        const take = Math.max(1, Math.min(50, limit));
        const rows = await prisma.edgeHypothesis.findMany({
            where: { status },
            orderBy: { statusUpdatedAt: 'desc' },
            take,
        });
        return rows.map(mapPrismaToEdgeHypothesis);
    }

    async findBySymbol(symbol: string): Promise<EdgeHypothesis[]> {
        const rows = await prisma.edgeHypothesis.findMany({
            where: { symbols: { has: symbol } },
            orderBy: { createdAt: 'desc' },
        });
        return rows.map(mapPrismaToEdgeHypothesis);
    }

    async findByCategory(category: EdgeCategory): Promise<EdgeHypothesis[]> {
        const rows = await prisma.edgeHypothesis.findMany({
            where: { category },
            orderBy: { createdAt: 'desc' },
        });
        return rows.map(mapPrismaToEdgeHypothesis);
    }

    /**
     * Phase 4d: 汎用検索（フィルタ・検索・ソート・ページネーション）。
     *
     * 既存の findByStatus / findByCategory / findBySymbol は破壊的に置き換えず
     * 共存させる（呼び出し側を壊さないため）。本メソッドは UI の一覧画面用に
     * 複数フィルタを AND 結合する。
     *
     * 未実装項目 (意図的):
     *   - sortBy: 'confidence' は未対応（EdgeHypothesis に confidence スコアが
     *     無いため運用後に定義を詰める。実装時は EdgeFindSortKey に追加）。
     *
     * @see docs/design/phase_4d_specification.md §4.2
     */
    async find(options: EdgeFindOptions = {}): Promise<EdgeFindResult> {
        const page = Math.max(1, options.page ?? 1);
        const limit = Math.max(1, Math.min(100, options.limit ?? 20));
        const skip = (page - 1) * limit;

        const where: Prisma.EdgeHypothesisWhereInput = {};

        if (options.statuses && options.statuses.length > 0) {
            where.status = { in: options.statuses };
        }
        if (options.categories && options.categories.length > 0) {
            where.category = { in: options.categories };
        }
        if (options.sources && options.sources.length > 0) {
            where.source = { in: options.sources };
        }
        if (options.symbols && options.symbols.length > 0) {
            where.symbols = { hasSome: options.symbols };
        }
        const trimmedSearch = options.search?.trim();
        if (trimmedSearch) {
            where.statement = { contains: trimmedSearch, mode: 'insensitive' };
        }

        const orderBy = EdgeLedger.resolveOrderBy(options.sortBy ?? 'newest');

        const [total, rows] = await Promise.all([
            prisma.edgeHypothesis.count({ where }),
            prisma.edgeHypothesis.findMany({ where, orderBy, skip, take: limit }),
        ]);

        return {
            hypotheses: rows.map(mapPrismaToEdgeHypothesis),
            total,
            page,
            limit,
        };
    }

    /** find() のソートキー → Prisma orderBy 変換。他の呼び出し元で使いたければ class static で露出させる。 */
    private static resolveOrderBy(
        sortBy: EdgeFindSortKey,
    ): Prisma.EdgeHypothesisOrderByWithRelationInput {
        switch (sortBy) {
            case 'oldest':
                return { createdAt: 'asc' };
            case 'observation':
                return { observationCount: 'desc' };
            case 'newest':
            default:
                return { createdAt: 'desc' };
        }
    }

    /**
     * 現在アクティブな仮説（confirmed）を指定シンボルで取得。
     */
    async findActive(symbol: string): Promise<EdgeHypothesis[]> {
        const rows = await prisma.edgeHypothesis.findMany({
            where: {
                status: 'confirmed',
                symbols: { has: symbol },
            },
            orderBy: { updatedAt: 'desc' },
        });
        return rows.map(mapPrismaToEdgeHypothesis);
    }

    /**
     * 指定シンボルに適用可能な仮説のうち、LensFeatureSnapshot に対して
     * 条件群が全て満たされているものを返す。
     *
     * Phase 4a では unverified も含めて返す（Strategy Thinker に候補として提示するため）。
     * 呼び出し側でステータスごとに扱いを変えること。
     */
    async findMatching(
        symbol: string,
        snapshot: LensFeatureSnapshot,
        options?: { statuses?: EdgeStatus[] },
    ): Promise<EdgeHypothesis[]> {
        const statuses = options?.statuses ?? ['confirmed', 'unverified'];
        const rows = await prisma.edgeHypothesis.findMany({
            where: {
                status: { in: statuses },
                symbols: { has: symbol },
            },
        });
        return rows
            .map(mapPrismaToEdgeHypothesis)
            .filter((h) => evaluateConditions(h.conditions, snapshot));
    }

    // --- ステータス遷移 ---

    async markTesting(id: string, note?: string): Promise<void> {
        await prisma.edgeHypothesis.update({
            where: { id },
            data: {
                status: 'testing',
                statusUpdatedAt: new Date(),
                statusNote: note,
            },
        });
    }

    /**
     * confirmed への昇格（Phase 4b の EdgeValidator が呼ぶ）。
     *
     * @param id 仮説 ID
     * @param backtest BT 結果（Phase 4b では WF から派生した値を渡す）
     * @param walkForward WF 結果（学習PF/検証PF/過学習スコア含む）
     * @param interpretation LLM による昇格理由の解釈（任意）
     */
    async markConfirmed(
        id: string,
        backtest: BacktestSummary,
        walkForward: WalkForwardSummary,
        interpretation?: string,
    ): Promise<void> {
        await prisma.edgeHypothesis.update({
            where: { id },
            data: {
                status: 'confirmed',
                statusUpdatedAt: new Date(),
                backtestResults: toPrismaJsonValue(backtest),
                walkForwardResults: toPrismaJsonValue(walkForward),
                lastTestedAt: new Date(),
                confirmationNote: interpretation,
            },
        });
    }

    async markStale(id: string, reason: string): Promise<void> {
        await prisma.edgeHypothesis.update({
            where: { id },
            data: {
                status: 'stale',
                statusUpdatedAt: new Date(),
                statusNote: reason,
            },
        });
    }

    async markRejected(id: string, reason: string): Promise<void> {
        await prisma.edgeHypothesis.update({
            where: { id },
            data: {
                status: 'rejected',
                statusUpdatedAt: new Date(),
                statusNote: reason,
            },
        });
    }

    /**
     * Phase 4b: 検証データ不足で保留
     */
    async markInsufficientData(id: string, reason: string): Promise<void> {
        await prisma.edgeHypothesis.update({
            where: { id },
            data: {
                status: 'insufficient_data',
                statusUpdatedAt: new Date(),
                statusNote: reason,
            },
        });
    }

    /**
     * Phase 4b: Side-A で検証不能と判断された仮説
     */
    async markNotTestable(id: string, reason: string): Promise<void> {
        await prisma.edgeHypothesis.update({
            where: { id },
            data: {
                status: 'not_testable',
                statusUpdatedAt: new Date(),
                statusNote: reason,
            },
        });
    }

    /**
     * 救済操作: not_testable 仮説を unverified に戻す(Critical-1.5 フォローアップ)。
     *
     * Critical-1 / 1.5 で screening の詰まりを解消した後、過去に同じバグで倒れた
     * 仮説を再 screening 可能にするための一括リセット。
     *
     * 任意で statusNote の前方一致パターンで対象を絞れる(例: "Materialization失敗" のみ)。
     * 何も指定しなければ status='not_testable' の全件を戻す。
     *
     * @returns 影響を受けた件数
     */
    async resetNotTestableToUnverified(options?: {
        statusNotePrefix?: string;
    }): Promise<number> {
        const where: Prisma.EdgeHypothesisWhereInput = { status: 'not_testable' };
        if (options?.statusNotePrefix !== undefined) {
            where.statusNote = { startsWith: options.statusNotePrefix };
        }
        const result = await prisma.edgeHypothesis.updateMany({
            where,
            data: {
                status: 'unverified',
                statusUpdatedAt: new Date(),
                statusNote: null,
            },
        });
        return result.count;
    }

    /**
     * Phase 4c: 本格検証通過として confirmed に昇格
     *
     * ConsolidatedValidationReport をそのまま fullValidationReport に保存し、
     * LLM 解釈と改善提案も一緒に記録する。
     */
    async markConfirmedFull(
        id: string,
        report: ConsolidatedValidationReport,
        interpretation?: string,
        actionableInsights?: string[],
    ): Promise<void> {
        await prisma.edgeHypothesis.update({
            where: { id },
            data: {
                status: 'confirmed',
                statusUpdatedAt: new Date(),
                fullValidationReport: toPrismaJsonValue(report),
                confirmationInterpretation: interpretation,
                actionableInsights: actionableInsights
                    ? { set: actionableInsights }
                    : undefined,
                lastTestedAt: new Date(),
            },
        });
    }

    /**
     * Phase 4c: 本格検証で rejected。レポートと理由を記録する。
     */
    async markRejectedFull(
        id: string,
        reason: string,
        report: ConsolidatedValidationReport,
        interpretation?: string,
        actionableInsights?: string[],
    ): Promise<void> {
        await prisma.edgeHypothesis.update({
            where: { id },
            data: {
                status: 'rejected',
                statusUpdatedAt: new Date(),
                statusNote: reason,
                fullValidationReport: toPrismaJsonValue(report),
                rejectionInterpretation: interpretation,
                actionableInsights: actionableInsights
                    ? { set: actionableInsights }
                    : undefined,
                lastTestedAt: new Date(),
            },
        });
    }

    /**
     * Phase 4b 縮小版: 事前スクリーニング通過として昇格
     */
    async markScreeningPassed(id: string, result: ScreeningResult): Promise<void> {
        await prisma.edgeHypothesis.update({
            where: { id },
            data: {
                status: 'screening_passed',
                statusUpdatedAt: new Date(),
                screeningResult: toPrismaJsonValue(result),
                lastTestedAt: new Date(),
                // Critical-4 段階 1 以降は tradeNoteId が無い (analysis-engine 経路は TradeNote を作らない)。
                // 旧経路で materialize された場合のみ既存 IDs に追加する。
                ...(result.tradeNoteId
                    ? { materializedTradeNoteIds: { set: [result.tradeNoteId] } }
                    : {}),
            },
        });
    }

    /**
     * Phase 4b 縮小版: スクリーニング結果の記録（通過可否に応じてステータスも遷移）
     *
     * - passed=true  → 'screening_passed'
     * - passed=false → 'rejected'（理由は statusNote に保存）
     *
     * not_testable（materialize 失敗）は別経路で markNotTestable() を呼ぶこと。
     */
    async recordScreeningResult(id: string, result: ScreeningResult): Promise<void> {
        if (result.passed) {
            await this.markScreeningPassed(id, result);
            return;
        }
        await prisma.edgeHypothesis.update({
            where: { id },
            data: {
                status: 'rejected',
                statusUpdatedAt: new Date(),
                statusNote: result.reasons?.join('; '),
                screeningResult: toPrismaJsonValue(result),
                lastTestedAt: new Date(),
                // Critical-4 段階 1 以降は tradeNoteId が無い場合があるためガードする
                ...(result.tradeNoteId
                    ? { materializedTradeNoteIds: { set: [result.tradeNoteId] } }
                    : {}),
            },
        });
    }

    /**
     * Phase 4b: materialize された TradeNote を仮説に紐付ける
     */
    async recordMaterialization(id: string, tradeNoteId: string): Promise<void> {
        const current = await this.get(id);
        if (!current) {
            throw new Error(`EdgeHypothesis not found: ${id}`);
        }
        const existing = current.materializedTradeNoteIds ?? [];
        const next = Array.from(new Set([...existing, tradeNoteId]));
        await prisma.edgeHypothesis.update({
            where: { id },
            data: {
                materializedTradeNoteIds: { set: next },
            },
        });
    }

    // --- 観測更新 ---

    /**
     * 観測結果を反映する。勝敗カウント、累計 PnL、平均 RR を更新。
     * 既存の relatedNoteIds に noteId を追加。
     */
    async recordObservation(
        id: string,
        observation: ObservationInput,
    ): Promise<EdgeHypothesis> {
        const current = await this.get(id);
        if (!current) {
            throw new Error(`EdgeHypothesis not found: ${id}`);
        }

        const nextObsCount = current.observationCount + 1;
        const nextTotalPnl = current.totalPnlPips + observation.pnlPips;
        const nextAvgRR =
            current.observationCount === 0
                ? observation.rr
                : (current.avgRR * current.observationCount + observation.rr) / nextObsCount;

        const counts = {
            win: current.winCount + (observation.outcome === 'win' ? 1 : 0),
            loss: current.lossCount + (observation.outcome === 'loss' ? 1 : 0),
            breakeven: current.breakevenCount + (observation.outcome === 'breakeven' ? 1 : 0),
        };

        const noteIds = Array.from(new Set([...current.relatedNoteIds ?? [], observation.noteId]));

        const updated = await prisma.edgeHypothesis.update({
            where: { id },
            data: {
                observationCount: nextObsCount,
                winCount: counts.win,
                lossCount: counts.loss,
                breakevenCount: counts.breakeven,
                totalPnlPips: nextTotalPnl,
                avgRR: nextAvgRR,
                lastObservedAt: new Date(),
                relatedNoteIds: { set: noteIds },
            },
        });
        return mapPrismaToEdgeHypothesis(updated);
    }

    // --- 統計 ---

    async getStats(): Promise<EdgeLedgerStats> {
        const all = await prisma.edgeHypothesis.findMany({
            select: { status: true, category: true, source: true },
        });

        const emptyStatusCount: Record<EdgeStatus, number> = {
            unverified: 0,
            screening_passed: 0,
            testing: 0,
            confirmed: 0,
            stale: 0,
            rejected: 0,
            insufficient_data: 0,
            not_testable: 0,
        };
        const emptyCategoryCount: Record<EdgeCategory, number> = {
            time: 0,
            level: 0,
            event: 0,
            correlation: 0,
            positioning: 0,
            volatility: 0,
            structure: 0,
            other: 0,
        };
        const emptySourceCount: Record<EdgeSource, number> = {
            ai_generated: 0,
            reflection: 0,
            user_input: 0,
            backtest: 0,
            discovery: 0,
        };

        for (const row of all) {
            if (row.status in emptyStatusCount) {
                emptyStatusCount[row.status as EdgeStatus]++;
            }
            if (row.category in emptyCategoryCount) {
                emptyCategoryCount[row.category as EdgeCategory]++;
            }
            if (row.source in emptySourceCount) {
                emptySourceCount[row.source as EdgeSource]++;
            }
        }

        return {
            totalCount: all.length,
            byStatus: emptyStatusCount,
            byCategory: emptyCategoryCount,
            bySource: emptySourceCount,
        };
    }
}

// ===========================================
// マッピング
// ===========================================

function mapPrismaToEdgeHypothesis(row: NonNullable<PrismaEdge>): EdgeHypothesis {
    return {
        id: row.id,
        statement: row.statement,
        category: row.category as EdgeCategory,
        conditions: fromPrismaJsonValue<MachineReadableCondition[]>(row.conditions) ?? [],
        expectedDirection: row.expectedDirection as EdgeHypothesis['expectedDirection'],
        status: row.status as EdgeStatus,
        statusUpdatedAt: row.statusUpdatedAt,
        statusNote: row.statusNote ?? undefined,
        symbols: row.symbols,
        timeframes: row.timeframes,
        observationCount: row.observationCount,
        winCount: row.winCount,
        lossCount: row.lossCount,
        breakevenCount: row.breakevenCount,
        totalPnlPips: row.totalPnlPips.toNumber(),
        avgRR: row.avgRR.toNumber(),
        backtestResults: fromPrismaJsonValue<BacktestSummary>(row.backtestResults),
        walkForwardResults: fromPrismaJsonValue<WalkForwardSummary>(row.walkForwardResults),
        source: row.source as EdgeSource,
        lensRelevance: fromPrismaJsonValue<Record<string, number>>(row.lensRelevance),
        firstObservedAt: row.firstObservedAt,
        lastObservedAt: row.lastObservedAt,
        lastTestedAt: row.lastTestedAt ?? undefined,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        parentIds: row.parentIds,
        relatedNoteIds: row.relatedNoteIds,
        // Phase 4b
        defaultRiskManagement: row.defaultRiskManagement
            ? fromPrismaJsonValue<EdgeHypothesis['defaultRiskManagement']>(row.defaultRiskManagement)
            : undefined,
        materializedTradeNoteIds: row.materializedTradeNoteIds ?? [],
        invalidationConditions: row.invalidationConditions
            ? fromPrismaJsonValue<MachineReadableCondition[]>(row.invalidationConditions)
            : undefined,
        confirmationNote: row.confirmationNote ?? undefined,
        screeningResult: row.screeningResult
            ? fromPrismaJsonValue<ScreeningResult>(row.screeningResult)
            : undefined,
        // Phase 4c
        fullValidationReport: row.fullValidationReport
            ? fromPrismaJsonValue<ConsolidatedValidationReport>(row.fullValidationReport)
            : undefined,
        confirmationInterpretation: row.confirmationInterpretation ?? undefined,
        rejectionInterpretation: row.rejectionInterpretation ?? undefined,
        actionableInsights: row.actionableInsights ?? [],
    };
}

// ===========================================
// シングルトンインスタンス
// ===========================================

export const edgeLedger = new EdgeLedger();
