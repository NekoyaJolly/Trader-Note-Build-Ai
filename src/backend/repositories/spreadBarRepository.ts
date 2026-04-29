/**
 * Phase 6.8: スプレッド集計バー repository
 *
 * cTrader の BID/ASK tick から作った spread series を、BT 実行時に再利用する。
 */

import type { SpreadBar } from '@prisma/client';
import { Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface SpreadBarInsertData {
  symbol: string;
  timeframe: string;
  timestamp: Date;
  avgSpread: number;
  maxSpread: number;
  p95Spread: number;
  tickCount: number;
  source?: string;
}

export interface SpreadBarQueryFilter {
  symbol: string;
  timeframe: string;
  startTime?: Date;
  endTime?: Date;
  limit?: number;
  orderBy?: 'asc' | 'desc';
}

export class SpreadBarRepository {
  async upsert(data: SpreadBarInsertData): Promise<SpreadBar> {
    return prisma.spreadBar.upsert({
      where: {
        symbol_timeframe_timestamp: {
          symbol: data.symbol,
          timeframe: data.timeframe,
          timestamp: data.timestamp,
        },
      },
      update: {
        avgSpread: new Prisma.Decimal(data.avgSpread),
        maxSpread: new Prisma.Decimal(data.maxSpread),
        p95Spread: new Prisma.Decimal(data.p95Spread),
        tickCount: data.tickCount,
        source: data.source ?? 'ctrader',
      },
      create: {
        symbol: data.symbol,
        timeframe: data.timeframe,
        timestamp: data.timestamp,
        avgSpread: new Prisma.Decimal(data.avgSpread),
        maxSpread: new Prisma.Decimal(data.maxSpread),
        p95Spread: new Prisma.Decimal(data.p95Spread),
        tickCount: data.tickCount,
        source: data.source ?? 'ctrader',
      },
    });
  }

  async bulkUpsert(dataList: SpreadBarInsertData[]): Promise<number> {
    let count = 0;
    for (const data of dataList) {
      await this.upsert(data);
      count++;
    }
    return count;
  }

  async findMany(filter: SpreadBarQueryFilter): Promise<SpreadBar[]> {
    const whereClause: Prisma.SpreadBarWhereInput = {
      symbol: filter.symbol,
      timeframe: filter.timeframe,
    };
    if (filter.startTime || filter.endTime) {
      whereClause.timestamp = {};
      if (filter.startTime) whereClause.timestamp.gte = filter.startTime;
      if (filter.endTime) whereClause.timestamp.lte = filter.endTime;
    }
    return prisma.spreadBar.findMany({
      where: whereClause,
      orderBy: { timestamp: filter.orderBy ?? 'asc' },
      take: filter.limit,
    });
  }
}
