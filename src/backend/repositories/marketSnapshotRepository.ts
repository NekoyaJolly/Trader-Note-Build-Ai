import { Prisma, MarketSnapshot } from '@prisma/client';
import { prisma } from '../db/client';

export interface MarketSnapshotCreateInput {
  symbol: string;
  timeframe: string;
  close: Prisma.Decimal | number | string;
  volume: Prisma.Decimal | number | string;
  indicators: Prisma.InputJsonValue;
  fetchedAt: Date;
}

/**
 * MarketSnapshot を扱うリポジトリ
 */
export class MarketSnapshotRepository {
  // 重複を避けるため (symbol, timeframe, fetchedAt) のユニークキーでアップサート
  async upsertSnapshot(input: MarketSnapshotCreateInput): Promise<MarketSnapshot> {
    return prisma.marketSnapshot.upsert({
      where: {
        symbol_timeframe_fetchedAt: {
          symbol: input.symbol,
          timeframe: input.timeframe,
          fetchedAt: input.fetchedAt,
        },
      },
      create: {
        symbol: input.symbol,
        timeframe: input.timeframe,
        close: input.close,
        volume: input.volume,
        indicators: input.indicators,
        fetchedAt: input.fetchedAt,
      },
      update: {
        close: input.close,
        volume: input.volume,
        indicators: input.indicators,
      },
    });
  }

  async countAll(): Promise<number> {
    return prisma.marketSnapshot.count();
  }

  async findLatest(symbol: string, timeframe: string): Promise<MarketSnapshot | null> {
    return prisma.marketSnapshot.findFirst({
      where: { symbol, timeframe },
      orderBy: { fetchedAt: 'desc' },
    });
  }
}
