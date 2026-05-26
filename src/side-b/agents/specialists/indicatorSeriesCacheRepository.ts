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

import { z } from 'zod';
import { prisma } from '../../../backend/db/client';
import { stableParamsKey } from '../../../backend/services/analysisEngineClient';

/**
 * DB の Json カラム `values` の shape を厳密検証する Zod schema。
 * 想定外データ (= 旧スキーマ / 破損 / 手動投入の不正値) を silent に通さない。
 */
const CachedValuesSchema = z.array(z.number().nullable());

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
 *
 * **`field` を含めた厳密 lookup** (PR #263 Copilot review #1): 同一 indicatorId で
 * 複数 field (例: macd / signal / histogram) を保存するケースで他 field の履歴が
 * 混ざるのを防ぐ。
 *
 * `values` は Json カラムなので Zod (`CachedValuesSchema`) で shape を検証し、
 * 不正データは空配列で返す (= silent な型崩れを避ける、PR #263 Copilot review #2)。
 */
export async function fetchRecentCacheEntries(args: {
  symbol: string;
  timeframe: string;
  indicatorId: string;
  params: Record<string, number>;
  field: string;
  limit: number;
}): Promise<Array<{ fetchedAt: Date; field: string; values: Array<number | null> }>> {
  const rows = await prisma.indicatorSeriesCache.findMany({
    where: {
      symbol: args.symbol,
      timeframe: args.timeframe,
      indicatorId: args.indicatorId,
      paramsHash: stableParamsKey(args.params),
      field: args.field,
    },
    orderBy: { fetchedAt: 'desc' },
    take: args.limit,
    select: { fetchedAt: true, field: true, values: true },
  });
  return rows.map((r) => {
    const parsed = CachedValuesSchema.safeParse(r.values);
    return {
      fetchedAt: r.fetchedAt,
      field: r.field,
      values: parsed.success ? parsed.data : [],
    };
  });
}

/**
 * 任意 retention 削除 (= 古いキャッシュをクリーンアップ、cron で呼ぶ想定)。
 *
 * **本 PR (Step 3a) では実装せず、Step 3b で本格運用時に raw SQL ベースで最適化する** 予定。
 * シグネチャだけ公開して後段の呼び出し側でモック化テストできるようにする。
 *
 * @param keepCount 各 (symbol, timeframe, indicatorId, paramsHash, field) ごとに保持する件数
 * @returns 削除件数 (= 現状常に 0)
 */
export function pruneOldCacheEntries(_args: {
  symbol?: string;
  keepCount: number;
}): number {
  // 現状は no-op (= safety)、Step 3b で実装
  return 0;
}
