import type { Prisma, Trade as PrismaTrade } from '@prisma/client';
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
 * ユーザー分離 (Phase α-4) の方針:
 * - HTTP 経路 (requireAuth 配下) からは必ず userId を渡し、所有ユーザーのデータのみ扱う
 * - cron / pipeline 経路 (ユーザー横断処理) は読み取りでは userId 未指定で全件を対象にする
 * - create 経路では Phase 6 以降 userId を必須にし、所有者不明の行を作らない
 */

/**
 * bulkInsert の戻り値型
 * count: 実際にinsertされた件数
 * insertedIds: 実際にinsertされたトレードのID配列
 */
export interface BulkInsertResult {
  count: number;
  insertedIds: string[];
}

/**
 * Trade テーブルを扱うリポジトリ
 */
export class TradeRepository {
  /**
   * トレードをまとめて保存（重複チェック付き）
   * timestamp + symbol + side の組み合わせで重複を判定
   * @returns 実際にinsertされた件数とID配列
   */
  async bulkInsert(trades: TradeCreateInput[], userId: string): Promise<BulkInsertResult> {
    if (trades.length === 0) return { count: 0, insertedIds: [] };

    // 既存のトレードを取得して重複チェック
    // ユーザー分離: 重複判定も所有ユーザー内に閉じる (他ユーザーの同一トレードと衝突させない)
    const existingTrades = await prisma.trade.findMany({
      where: userId ? { userId } : undefined,
      select: { timestamp: true, symbol: true, side: true },
    });
    
    // 既存トレードのキーセットを作成
    const existingKeys = new Set(
      existingTrades.map(t => `${t.timestamp.toISOString()}_${t.symbol}_${t.side}`)
    );
    
    // 重複を除外
    const newTrades = trades.filter(t => {
      const key = `${t.timestamp.toISOString()}_${t.symbol}_${t.side}`;
      return !existingKeys.has(key);
    });
    
    if (newTrades.length === 0) {
      console.log('[TradeRepository] All trades already exist, skipping insert');
      return { count: 0, insertedIds: [] };
    }

    const result = await prisma.trade.createMany({
      data: newTrades.map((t) => ({
        id: t.id,
        timestamp: t.timestamp,
        symbol: t.symbol,
        side: t.side,
        price: t.price,
        quantity: t.quantity,
        fee: t.fee ?? undefined,
        exchange: t.exchange ?? undefined,
        userId,
      })),
      skipDuplicates: true,
    });

    console.log(`[TradeRepository] Inserted ${result.count} new trades (${trades.length - newTrades.length} duplicates skipped)`);
    return { count: result.count, insertedIds: newTrades.map(t => t.id) };
  }

  // 登録済み件数を確認するためのヘルパー
  async countAll(userId?: string): Promise<number> {
    return prisma.trade.count({ where: userId ? { userId } : undefined });
  }

  // ノート未生成のトレードを取得（古い順）
  async findTradesWithoutNotes(limit: number = 500, userId?: string): Promise<PrismaTrade[]> {
    return prisma.trade.findMany({
      where: { note: null, ...(userId ? { userId } : {}) },
      orderBy: { timestamp: 'asc' },
      take: limit,
    });
  }

  // 指定した ID 群のトレードを取得（順序はDB任せ）
  async findByIds(ids: string[], userId?: string): Promise<PrismaTrade[]> {
    if (ids.length === 0) return [];
    return prisma.trade.findMany({
      where: { id: { in: ids }, ...(userId ? { userId } : {}) },
      orderBy: { timestamp: 'asc' },
    });
  }
}
