/**
 * MaterializationService (Critical-4 段階 3b 後の縮小版)
 *
 * 旧責務 (`materializeForValidation` = 仮説 → Side-A TradeNote 変換 + 旧 BT 入力組立) は
 * 段階 1 で screening が analysis-engine 経由になり、段階 3b でこのメソッドは完全削除。
 *
 * 残る責務: 明示 userId を受け取った VirtualTrade を **TradeNote** として昇格する経路
 * (`materializeFromVirtualTrade` のみ)。Phase 6 以降は自動同時生成では呼ばない。
 *
 * @see docs/design/critical_4_bt_unification.md §3 段階 3
 */

import { Prisma } from '@prisma/client';
import type { NoteStatus, TradeSide } from '@prisma/client';
import { prisma } from '../../backend/db/client';
import type { FeatureVector12D } from '../../services/featureVectorService';
import {
    createNoteLensSnapshot,
    type LensSnapshotEntry,
    type NoteLensSnapshot,
} from '../../shared/similarity/lensSnapshotTypes';
import type { AITradeNote } from '../models/aiTradeNote';

// ===========================================
// 型
// ===========================================

/**
 * VirtualTrade 完了時に TradeNote として記録するための入力
 */
export interface MaterializeFromVirtualTradeInput {
    /** Side-A Trade/TradeNote の所有ユーザー。Phase 6 以降は必須。 */
    userId: string;
    /** Side-B AITradeNote の来歴。指定時は Note コアと AITradeNote.tradeNoteId も同時に更新する。 */
    aiTradeNoteId?: string;
    symbol: string;
    side: 'long' | 'short';
    entryPrice: number;
    enteredAt: Date;
    timeframe?: string;
    higherTimeframe?: string;
    /** AITradeNote 側に既に保存された featureVector。未指定時は lensSnapshot から決定論的に派生する。 */
    featureVector?: number[];
    /** AITradeNote.lensSnapshot。Note コア用の正準形と legacy 12D featureVector の派生元。 */
    lensSnapshot?: AITradeNote['lensSnapshot'];
    /** Side-A 監視対象にする場合は active、履歴だけ残す場合は archived を指定する。 */
    status?: NoteStatus;
    /** 既に紐づく TradeNote がある場合は重複作成せず再有効化する。 */
    existingTradeNoteId?: string;
}

interface SideBNoteCoreInput {
    userId: string;
    aiTradeNoteId: string;
    tradeNoteId: string;
    symbol: string;
    side: TradeSide;
    timeframe: string;
    higherTimeframe?: string;
    entryPrice: number;
    eventTime: Date;
    lensSnapshot: NoteLensSnapshot | null;
}

type TransactionClient = Prisma.TransactionClient;

const SIDE_B_LEGACY_LENS_VERSION = 'side-b-legacy';

// ===========================================
// MaterializationService 本体
// ===========================================

export class MaterializationService {
    /**
     * VirtualTrade を Side-A TradeNote として明示的に昇格する。
     *
     * **best-effort**: 失敗しても呼び出し側の AITradeNote 作成は継続させる。
     * 例外を投げるのは呼び出し側の判断に任せる。
     *
     * @returns 作成された TradeNote ID
     */
    async materializeFromVirtualTrade(
        input: MaterializeFromVirtualTradeInput,
    ): Promise<string> {
        const side: TradeSide = input.side === 'short' ? 'sell' : 'buy';
        const featureVector = input.featureVector ?? deriveFeatureVectorFromSideBLensSnapshot(
            input.lensSnapshot,
            input.side,
            input.enteredAt,
        );
        const noteLensSnapshot = toNoteLensSnapshotFromSideBLensSnapshot({
            snapshot: input.lensSnapshot,
            symbol: input.symbol,
            timeframe: input.timeframe ?? '15m',
            higherTimeframe: input.higherTimeframe,
            eventTime: input.enteredAt,
        });

        if (input.existingTradeNoteId) {
            return await this.reactivateExistingMaterializedNote({
                tradeNoteId: input.existingTradeNoteId,
                aiTradeNoteId: input.aiTradeNoteId,
                userId: input.userId,
                symbol: input.symbol,
                side,
                entryPrice: input.entryPrice,
                timeframe: input.timeframe,
                higherTimeframe: input.higherTimeframe,
                featureVector,
                tradedAt: input.enteredAt,
                lensSnapshot: noteLensSnapshot,
            });
        }

        const { tradeNoteId } = await this.createTradeAndNote({
            symbol: input.symbol,
            side,
            entryPrice: input.entryPrice,
            timeframe: input.timeframe,
            higherTimeframe: input.higherTimeframe,
            featureVector,
            tradedAt: input.enteredAt,
            userId: input.userId,
            aiTradeNoteId: input.aiTradeNoteId,
            lensSnapshot: noteLensSnapshot,
            status: input.status ?? 'archived',
        });

        return tradeNoteId;
    }

    /**
     * 本番運用から外された Side-B 昇格ノートを Side-A 側でも監視対象外へ戻す。
     * human ノートの誤アーカイブを避けるため、Side-B materialize タグ付きだけを対象にする。
     */
    async archiveMaterializedTradeNote(input: {
        tradeNoteId: string;
        userId: string;
    }): Promise<void> {
        const result = await prisma.tradeNote.updateMany({
            where: {
                id: input.tradeNoteId,
                userId: input.userId,
                tags: { has: 'side_b_materialized' },
            },
            data: {
                status: 'archived',
                archivedAt: new Date(),
            },
        });

        if (result.count === 0) {
            throw new Error('Side-B 昇格ノートの所有者確認またはタグ確認に失敗しました');
        }
    }

    /**
     * Trade + TradeNote をトランザクションで作成する。
     */
    private async createTradeAndNote(args: {
        symbol: string;
        side: TradeSide;
        entryPrice: number;
        timeframe?: string;
        higherTimeframe?: string;
        featureVector: number[];
        indicatorConfig?: Prisma.InputJsonValue | null;
        hypothesisId?: string;
        tradedAt?: Date;
        userId: string;
        aiTradeNoteId?: string;
        lensSnapshot: NoteLensSnapshot | null;
        status: NoteStatus;
    }): Promise<{ tradeId: string; tradeNoteId: string }> {
        return await prisma.$transaction(async (tx) => {
            const trade = await tx.trade.create({
                data: {
                    timestamp: args.tradedAt ?? new Date(),
                    symbol: args.symbol,
                    side: args.side,
                    price: args.entryPrice,
                    quantity: 1, // 検証用は数量1で固定
                    userId: args.userId,
                },
            });

            const note = await tx.tradeNote.create({
                data: {
                    tradeId: trade.id,
                    symbol: args.symbol,
                    side: args.side,
                    entryPrice: args.entryPrice,
                    featureVector: args.featureVector,
                    timeframe: args.timeframe,
                    indicators: {},
                    indicatorConfig:
                        args.indicatorConfig === undefined || args.indicatorConfig === null
                            ? undefined
                            : args.indicatorConfig,
                    status: args.status,
                    activatedAt: args.status === 'active' ? new Date() : undefined,
                    archivedAt: args.status === 'archived' ? new Date() : undefined,
                    userId: args.userId,
                    tags: args.hypothesisId
                        ? ['edge_hypothesis_temp', `hyp:${args.hypothesisId}`]
                        : ['side_b_materialized'],
                },
            });

            if (args.aiTradeNoteId !== undefined) {
                await tx.aITradeNote.update({
                    where: { id: args.aiTradeNoteId },
                    data: { tradeNoteId: note.id },
                });

                await this.upsertSideBNoteCore(tx, {
                    userId: args.userId,
                    aiTradeNoteId: args.aiTradeNoteId,
                    tradeNoteId: note.id,
                    symbol: args.symbol,
                    side: args.side,
                    timeframe: args.timeframe ?? '15m',
                    higherTimeframe: args.higherTimeframe,
                    entryPrice: args.entryPrice,
                    eventTime: args.tradedAt ?? new Date(),
                    lensSnapshot: args.lensSnapshot,
                });
            }

            return { tradeId: trade.id, tradeNoteId: note.id };
        });
    }

    private async reactivateExistingMaterializedNote(args: {
        tradeNoteId: string;
        aiTradeNoteId?: string;
        userId: string;
        symbol: string;
        side: TradeSide;
        entryPrice: number;
        timeframe?: string;
        higherTimeframe?: string;
        featureVector: number[];
        tradedAt: Date;
        lensSnapshot: NoteLensSnapshot | null;
    }): Promise<string> {
        return await prisma.$transaction(async (tx) => {
            const result = await tx.tradeNote.updateMany({
                where: {
                    id: args.tradeNoteId,
                    userId: args.userId,
                },
                data: {
                    symbol: args.symbol,
                    side: args.side,
                    entryPrice: args.entryPrice,
                    featureVector: args.featureVector,
                    timeframe: args.timeframe,
                    status: 'active',
                    enabled: true,
                    pausedUntil: null,
                    activatedAt: new Date(),
                    archivedAt: null,
                },
            });

            if (result.count === 0) {
                throw new Error('既存 Side-B 昇格ノートの所有者確認に失敗しました');
            }

            if (args.aiTradeNoteId !== undefined) {
                await tx.aITradeNote.update({
                    where: { id: args.aiTradeNoteId },
                    data: { tradeNoteId: args.tradeNoteId },
                });

                await this.upsertSideBNoteCore(tx, {
                    userId: args.userId,
                    aiTradeNoteId: args.aiTradeNoteId,
                    tradeNoteId: args.tradeNoteId,
                    symbol: args.symbol,
                    side: args.side,
                    timeframe: args.timeframe ?? '15m',
                    higherTimeframe: args.higherTimeframe,
                    entryPrice: args.entryPrice,
                    eventTime: args.tradedAt,
                    lensSnapshot: args.lensSnapshot,
                });
            }

            return args.tradeNoteId;
        });
    }

    private async upsertSideBNoteCore(
        tx: TransactionClient,
        input: SideBNoteCoreInput,
    ): Promise<void> {
        const snapshotJson: Prisma.InputJsonValue | typeof Prisma.DbNull =
            input.lensSnapshot === null ? Prisma.DbNull : input.lensSnapshot;
        const common = {
            userId: input.userId,
            source: 'side_b_ai' as const,
            symbol: input.symbol,
            side: input.side,
            timeframe: input.timeframe,
            higherTimeframe: input.higherTimeframe ?? null,
            entryPrice: input.entryPrice,
            eventTime: input.eventTime,
            lensSnapshot: snapshotJson,
            snapshotSchemaVersion: input.lensSnapshot?.snapshotSchemaVersion ?? null,
            tradeNoteId: input.tradeNoteId,
            aiTradeNoteId: input.aiTradeNoteId,
        };

        const existingRows = await tx.note.findMany({
            where: {
                OR: [
                    { tradeNoteId: input.tradeNoteId },
                    { aiTradeNoteId: input.aiTradeNoteId },
                ],
            },
            take: 2,
        });

        if (existingRows.length > 1) {
            throw new Error('Note コアの Side-A / Side-B 来歴が別行に分離しています');
        }

        const existing = existingRows[0];
        if (existing) {
            await tx.note.update({
                where: { id: existing.id },
                data: common,
            });
            return;
        }

        await tx.note.create({ data: common });
    }
}

export const materializationService = new MaterializationService();

export function deriveFeatureVectorFromSideBLensSnapshot(
    snapshot: AITradeNote['lensSnapshot'],
    side: 'long' | 'short',
    eventTime: Date,
): FeatureVector12D {
    if (snapshot === undefined) {
        throw new Error('Side-B materialize には featureVector または lensSnapshot が必要です');
    }

    const current = snapshot.features.current_analysis;
    const rsi = findLensFeatures(snapshot, 'ind:rsi');
    const macd = findLensFeatures(snapshot, 'ind:macd');
    const bb = findLensFeatures(snapshot, 'ind:bb');

    const trendStrength = scoreFeature(current, 'trend_strength', 0.5);
    const momentum = scoreFeature(current, 'momentum', 0.5);
    const volatility = scoreFeature(current, 'volatility_score', 0.5);
    const rsiValue = numericFeature(rsi, 'rsi_value');
    const bbPosition = numericFeature(bb, 'bb_position');
    const bbWidth = numericFeature(bb, 'bb_width_norm');
    const macdSlope = numericFeature(macd, 'macd_hist_slope');

    return [
        directionFeature(current, side),
        trendStrength,
        trendStrength,
        macdSlope ?? ((momentum - 0.5) * 2),
        macdCrossFeature(macd, momentum),
        clamp01(rsiValue ?? momentum),
        rsiZoneFeature(rsi, rsiValue ?? momentum),
        clamp01(bbPosition ?? 0.5),
        clamp01(bbWidth ?? volatility),
        0.5,
        side === 'long' ? 1 : 0,
        sessionFeature(eventTime),
    ];
}

function toNoteLensSnapshotFromSideBLensSnapshot(params: {
    snapshot: AITradeNote['lensSnapshot'];
    symbol: string;
    timeframe: string;
    higherTimeframe?: string;
    eventTime: Date;
}): NoteLensSnapshot | null {
    if (params.snapshot === undefined) {
        return null;
    }

    const lenses: Record<string, LensSnapshotEntry> = {};
    for (const [lensId, features] of Object.entries(params.snapshot.features)) {
        lenses[lensId] = {
            lensVersion: SIDE_B_LEGACY_LENS_VERSION,
            confidence: confidenceFromFeatures(features),
            features: { ...features },
        };
    }

    return createNoteLensSnapshot({
        symbol: params.symbol,
        timeframe: params.timeframe,
        higherTimeframe: params.higherTimeframe,
        eventTime: params.eventTime,
        lenses,
    });
}

function findLensFeatures(
    snapshot: NonNullable<AITradeNote['lensSnapshot']>,
    prefix: string,
): Record<string, number | string | boolean> | undefined {
    for (const [lensId, features] of Object.entries(snapshot.features)) {
        if (lensId === prefix || lensId.startsWith(`${prefix}#`)) {
            return features;
        }
    }
    return undefined;
}

function numericFeature(
    features: Record<string, number | string | boolean> | undefined,
    key: string,
): number | undefined {
    const value = features?.[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function scoreFeature(
    features: Record<string, number | string | boolean> | undefined,
    key: string,
    fallback: number,
): number {
    const value = numericFeature(features, key);
    return value === undefined ? fallback : clamp01(value / 100);
}

function directionFeature(
    features: Record<string, number | string | boolean> | undefined,
    side: 'long' | 'short',
): number {
    const value = features?.direction;
    if (value === 'bullish') return 1;
    if (value === 'bearish') return -1;
    if (value === 'neutral') return 0;
    return side === 'long' ? 1 : -1;
}

function macdCrossFeature(
    features: Record<string, number | string | boolean> | undefined,
    momentum: number,
): number {
    const cross = features?.macd_cross;
    if (cross === 'bull' || cross === 'bullish') return 1;
    if (cross === 'bear' || cross === 'bearish') return 0;
    if (cross === 'none') return 0.5;
    if (momentum > 0.55) return 1;
    if (momentum < 0.45) return 0;
    return 0.5;
}

function rsiZoneFeature(
    features: Record<string, number | string | boolean> | undefined,
    rsiValue: number,
): number {
    const zone = features?.rsi_zone;
    if (zone === 'overbought') return 1;
    if (zone === 'oversold') return 0;
    if (zone === 'neutral') return 0.5;
    if (rsiValue >= 0.7) return 1;
    if (rsiValue <= 0.3) return 0;
    return 0.5;
}

function sessionFeature(eventTime: Date): number {
    const hour = eventTime.getUTCHours();
    if (hour >= 0 && hour < 9) return 0.2;
    if (hour >= 13 && hour < 22) return 0.8;
    if (hour >= 7 && hour < 16) return 0.5;
    return 0.5;
}

function confidenceFromFeatures(
    features: Record<string, number | string | boolean>,
): number {
    const confidencePct = numericFeature(features, 'confidence_pct');
    if (confidencePct !== undefined) {
        return clamp01(confidencePct / 100);
    }
    return 1;
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) {
        return 0.5;
    }
    return Math.min(1, Math.max(0, value));
}
