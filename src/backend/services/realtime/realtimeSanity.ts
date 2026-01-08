/**
 * リアルタイム価格データの健全性チェック（純粋関数）
 *
 * 目的:
 * - DBに混入した「スケール違い（例: 1000倍/100000倍）」のバーを UI 初期表示から除外する
 * - 参照価格（直近Tick/進行中バー）を基準に、同一スケールのデータだけを採用する
 *
 * 注意:
 * - ここはDB/ネットワークに依存しない純粋関数とし、ユニットテスト対象にする
 */

export type PriceBarLike = {
  open: number;
  high: number;
  low: number;
  close: number;
};

function isFinitePositive(n: number): boolean {
  return Number.isFinite(n) && n > 0;
}

/**
 * 中央値を計算（偶数長の場合は2つの中央値の平均）
 */
export function calculateMedian(values: number[]): number {
  const filtered = values.filter((v) => Number.isFinite(v));
  if (filtered.length === 0) return 0;

  const sorted = [...filtered].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

export type CloseStats = {
  count: number;
  min: number;
  max: number;
  median: number;
};

/**
 * close の基本統計（min/max/median）
 */
export function getCloseStats<T extends PriceBarLike>(bars: T[]): CloseStats {
  const closes = bars.map((b) => b.close).filter((v) => Number.isFinite(v));
  if (closes.length === 0) {
    return { count: 0, min: 0, max: 0, median: 0 };
  }
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const median = calculateMedian(closes);
  return { count: closes.length, min, max, median };
}

/**
 * 参照価格を基準に、同一スケールとみなせるバーのみを残す
 *
 * - deviationThreshold=0.5 は「±50%」の許容（異常値フィルタと同じ考え方）
 * - close を中心に判定（high/low の極端な外れも弾く）
 */
export function filterBarsByReferencePrice<T extends PriceBarLike>(
  bars: T[],
  referencePrice: number,
  deviationThreshold: number = 0.5
): T[] {
  if (!isFinitePositive(referencePrice)) return bars;
  if (!Number.isFinite(deviationThreshold) || deviationThreshold <= 0) return bars;

  return bars.filter((bar) => {
    if (!isFinitePositive(bar.close)) return false;
    if (!Number.isFinite(bar.high) || !Number.isFinite(bar.low)) return false;

    const closeDev = Math.abs(bar.close - referencePrice) / referencePrice;
    const highDev = Math.abs(bar.high - referencePrice) / referencePrice;
    const lowDev = Math.abs(bar.low - referencePrice) / referencePrice;

    return (
      closeDev <= deviationThreshold &&
      highDev <= deviationThreshold &&
      lowDev <= deviationThreshold
    );
  });
}

/**
 * バー集合が「スケール異常っぽい」かを雑に判定
 *
 * 目的:
 * - DB側が汚染されている時、初期表示でそれを採用せず Trendbar にフォールバックする
 *
 * 判定方針:
 * - median が極端に大きい/小さい
 * - max/min のレンジが短期データとして不自然に広い
 */
export function looksLikeMisScaledBars<T extends PriceBarLike>(
  bars: T[],
  opts?: {
    minReasonablePrice?: number;
    maxReasonablePrice?: number;
    maxRangeRatio?: number;
  }
): boolean {
  if (bars.length < 3) return false;

  const { min, max, median } = getCloseStats(bars);
  if (!isFinitePositive(median)) return true;

  const minReasonable = opts?.minReasonablePrice ?? 0.05;
  // FX/金属（XAUUSD 等）用途では 50万を超える "close" はスケール違いの可能性が高い
  // （例: 4,600,000 = 4,600 * 1000 のような誤変換）
  const maxReasonable = opts?.maxReasonablePrice ?? 500_000;
  const maxRangeRatio = opts?.maxRangeRatio ?? 50;

  if (median < minReasonable || median > maxReasonable) return true;
  if (isFinitePositive(min) && max > 0) {
    const ratio = max / min;
    if (Number.isFinite(ratio) && ratio > maxRangeRatio) return true;
  }

  return false;
}


