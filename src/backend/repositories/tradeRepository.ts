import { Prisma, Trade as PrismaTrade } from '@prisma/client';
import { prisma } from '../db/client';

export interface TradeCreateInput {
  id: string;
  timestamp: Date;
  symbol: string;
  side: PrismaTrade['side'];
  price: Prisma.Decimal | number | string;
  quantity: Prisma.Decimal | number | string;
  fee?: Prisma.Decimal | number | string;
  exchange?: string | null;
}

/**
 * Trade テーブルを扱うリポジトリ
 */
export class TradeRepository {
  // トレードをまとめて保存（既存IDとは衝突しない前提で createMany）
  async bulkInsert(trades: TradeCreateInput[]): Promise<number> {
    if (trades.length === 0) return 0;

    const result = await prisma.trade.createMany({
      data: trades.map((t) => ({
        id: t.id,
        timestamp: t.timestamp,
        symbol: t.symbol,
        side: t.side,
        price: t.price,
        quantity: t.quantity,
        fee: t.fee ?? undefined,
        exchange: t.exchange ?? undefined,
      })),
      skipDuplicates: false,
    });

    return result.count;
  }

  // 登録済み件数を確認するためのヘルパー
  async countAll(): Promise<number> {
    return prisma.trade.count();
  }

  // ノート未生成のトレードを取得（古い順）
  async findTradesWithoutNotes(limit: number = 500): Promise<PrismaTrade[]> {
    return prisma.trade.findMany({
      where: { note: null },
      orderBy: { timestamp: 'asc' },
      take: limit,
    });
  }
}
