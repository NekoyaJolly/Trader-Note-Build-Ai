/**
 * IndicatorSeriesCache repository (Phase 6.8 Step 3、2026-05-27)
 *
 * analysis-engine から取得した indicator 系列を symbol × timeframe × indicator × params
 * 単位でキャッシュし、後続フェーズ (= Step 3b prompt 反映) で「前回 / 前々回」との比較を
 * 可能にする。
 *
 * 本 PR (Step 3a) の責務: **書き込み** + **直近 N 件取得** の最小 API。実際に prompt へ
 * 注入するのは別 PR (Step 3b)。
 *
 * 設計書: docs/architecture/INDICATOR_SPECIALIST_DESIGN.md
 */

import { prisma } from '../../../backend/db/client';
import { stableParamsKey } from '../../../backend/services/analysisEngineClient';

export interface CacheEntry {
  symbol: string;
  timeframe: string;
  indicatorId: string;
  params: Record<string, number>;
  field: string;
  values: Array<number | null>;
  startDate: Date;
  endDate: Date;
}

/**
 * 1 つの cache entry を書き込み。
 * 同一 (symbol, timeframe, indicatorId, paramsHash) でも複数行が時系列で蓄積される
 * (= 直近 N 件で「流れ」を見るため、上書き update ではなく append insert)。
 */
export async function writeIndicatorCacheEntry(entry: CacheEntry): Promise<void> {
  await prisma.indicatorSeriesCache.create({
    data: {
      symbol: entry.symbol,
      timeframe: entry.timeframe,
      indicatorId: entry.indicatorId,
      paramsHash: stableParamsKey(entry.params),
      field: entry.field,
      values: entry.values,
      startDate: entry.startDate,
      endDate: entry.endDate,
      // fetchedAt は default(now()) で自動付与
    },
  });
}

/**
 * 直近 N 件のキャッシュ取得 (Step 3b で prompt 反映時に利用)。
 *
 * `fetchedAt` 降順で `take=N`、最新が [0]、前回が [1]、前々回が [2]。
 */
export async function fetchRecentCacheEntries(args: {
  symbol: string;
  timeframe: string;
  indicatorId: string;
  params: Record<string, number>;
  limit: number;
}): Promise<Array<{ fetchedAt: Date; values: Array<number | null> }>> {
  const rows = await prisma.indicatorSeriesCache.findMany({
    where: {
      symbol: args.symbol,
      timeframe: args.timeframe,
      indicatorId: args.indicatorId,
      paramsHash: stableParamsKey(args.params),
    },
    orderBy: { fetchedAt: 'desc' },
    take: args.limit,
    select: { fetchedAt: true, values: true },
  });
  return rows.map((r) => ({
    fetchedAt: r.fetchedAt,
    values: r.values as Array<number | null>,
  }));
}

/**
 * 任意 retention 削除 (= 古いキャッシュをクリーンアップ、cron で呼ぶ想定)。
 * 本 PR では未配線、Step 3b 以降で必要に応じて使う。
 *
 * @param symbol 対象 symbol (= null なら全 symbol)
 * @param keepCount 各 (symbol, timeframe, indicatorId, paramsHash) ごとに保持する件数
 * @returns 削除件数
 */
export async function pruneOldCacheEntries(args: {
  symbol?: string;
  keepCount: number;
}): Promise<number> {
  // 簡易実装: 古い fetchedAt を順次削除。完全な per-key 制限は raw SQL でないと
  // 効率が悪いので、Step 3b で本格運用時に最適化する。
  // 本 PR は API のみ用意、未使用。
  const cutoffPerKey = args.keepCount;
  if (cutoffPerKey <= 0) return 0;
  // 現状は no-op (= safety)、Step 3b で実装
  return 0;
}
