/**
 * Phase 6.8: cTrader tick 由来の spread bar を取得・DBキャッシュする
 */

import { PrismaClient } from '@prisma/client';
import { CTraderAuthService } from './ctrader/ctraderAuthService';
import { CTraderDataService } from './ctrader/ctraderDataService';
import { SpreadBarRepository } from '../repositories/spreadBarRepository';

const prisma = new PrismaClient();
const ctraderAuthService = new CTraderAuthService(prisma);
const ctraderDataService = new CTraderDataService(ctraderAuthService);
const spreadBarRepository = new SpreadBarRepository();

const TIMEFRAME_MS: Record<string, number> = {
  '1m': 60 * 1000,
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
};

export interface FetchAndCacheSpreadBarsResult {
  success: boolean;
  cachedCount: number;
  error?: string;
  details?: {
    symbol: string;
    timeframe: string;
    startDate: string;
    endDate: string;
    fetchedCount: number;
  };
}

export function isSpreadRemoteFetchAvailable(): boolean {
  return ctraderDataService.isConfigured();
}

export async function fetchAndCacheSpreadBars(
  symbol: string,
  timeframe: string,
  startDate: Date,
  endDate: Date,
): Promise<FetchAndCacheSpreadBarsResult> {
  const timeframeMs = TIMEFRAME_MS[timeframe];
  if (!timeframeMs) {
    return { success: false, cachedCount: 0, error: `未対応timeframe: ${timeframe}` };
  }

  try {
    const ctraderToken = await prisma.cTraderToken.findFirst({
      orderBy: { lastConnectedAt: 'desc' },
    });
    if (!ctraderToken) {
      return { success: false, cachedCount: 0, error: 'cTrader OAuth トークンがありません' };
    }

    const spreadBars = await ctraderDataService.fetchSpreadSeriesInRange(
      ctraderToken.accountId,
      symbol,
      startDate,
      endDate,
      timeframeMs,
    );
    const cachedCount = await spreadBarRepository.bulkUpsert(
      spreadBars.map((bar) => ({
        symbol,
        timeframe,
        timestamp: bar.timestamp,
        avgSpread: bar.avgSpread,
        maxSpread: bar.maxSpread,
        p95Spread: bar.p95Spread,
        tickCount: bar.tickCount,
        source: 'ctrader',
      })),
    );

    return {
      success: true,
      cachedCount,
      details: {
        symbol,
        timeframe,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        fetchedCount: spreadBars.length,
      },
    };
  } catch (error) {
    return {
      success: false,
      cachedCount: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
