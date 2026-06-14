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

import type { Prisma, TradeSide } from '@prisma/client';
import { prisma } from '../../backend/db/client';

// ===========================================
// 型
// ===========================================

/**
 * VirtualTrade 完了時に TradeNote として記録するための入力
 */
export interface MaterializeFromVirtualTradeInput {
    /** Side-A Trade/TradeNote の所有ユーザー。Phase 6 以降は必須。 */
    userId: string;
    symbol: string;
    side: 'long' | 'short';
    entryPrice: number;
    enteredAt: Date;
    timeframe?: string;
    /** AITradeNote 側に既に保存された featureVector (なければ仮値で埋める) */
    featureVector?: number[];
}

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
        const featureVector = input.featureVector ?? Array<number>(12).fill(0.5);

        const { tradeNoteId } = await this.createTradeAndNote({
            symbol: input.symbol,
            side,
            entryPrice: input.entryPrice,
            timeframe: input.timeframe,
            featureVector,
            tradedAt: input.enteredAt,
            userId: input.userId,
        });

        return tradeNoteId;
    }

    /**
     * Trade + TradeNote をトランザクションで作成する。
     */
    private async createTradeAndNote(args: {
        symbol: string;
        side: TradeSide;
        entryPrice: number;
        timeframe?: string;
        featureVector: number[];
        indicatorConfig?: Prisma.InputJsonValue | null;
        hypothesisId?: string;
        tradedAt?: Date;
        userId: string;
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
                    status: 'archived', // Side-A の UI に表示しない (汚染防止)
                    userId: args.userId,
                    tags: args.hypothesisId
                        ? ['edge_hypothesis_temp', `hyp:${args.hypothesisId}`]
                        : ['side_b_materialized'],
                },
            });

            return { tradeId: trade.id, tradeNoteId: note.id };
        });
    }
}

export const materializationService = new MaterializationService();
