/**
 * OHLCV 集約ユーティリティ (Phase B、EODHD 切替用)
 *
 * EODHD intraday API は `1m / 5m / 1h` の 3 間隔のみ対応のため、
 * 内部 Timeframe (`15m / 30m / 4h`) は EODHD 取得後にクライアント側で集約する。
 *
 * 設計方針:
 * - 純粋関数のみで構成 (副作用なし・I/O なし)
 * - バケット境界は UTC 0 を起点に揃える (15m → :00/:15/:30/:45)
 * - 不完全バケット (= 端で source bar 数が factor 未満) は破棄しない:
 *   呼び出し側が必要に応じて末尾を slice する
 */

import type { OHLCVBar, Timeframe } from './IMarketDataProvider';

/**
 * 各 Timeframe を ms (= ミリ秒) に換算した定数表。
 *
 * `4h = 4 * 60 * 60 * 1000` のような誤読を防ぐため、ハードコードではなく
 * 派生計算で書いている。`1d` は 24h 換算 (= 86_400_000 ms)、`1w` は 7d 換算。
 */
export const TIMEFRAME_MS: Record<Timeframe, number> = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
  '1w': 7 * 24 * 60 * 60_000,
};

/** EODHD intraday の interval 列挙 (SDK 型と一致) */
export type EodhdIntradayInterval = '1m' | '5m' | '1h';

/** EODHD eod の period 列挙 (SDK 型のうち本プロジェクトで使うもの) */
export type EodhdEodPeriod = 'd' | 'w';

/**
 * 内部 Timeframe から EODHD 取得計画を決定する。
 *
 * - kind=`intraday`: intraday API を `interval` で叩き、`factor` 倍に集約する
 *   (factor=1 なら集約不要、そのまま使用)
 * - kind=`eod`: eod API を `period` で叩く (集約不要)
 */
export type EodhdFetchPlan =
  | { kind: 'intraday'; interval: EodhdIntradayInterval; factor: number }
  | { kind: 'eod'; period: EodhdEodPeriod };

/**
 * 内部 Timeframe → EODHD 取得計画。
 *
 * - 1m / 5m / 1h: ネイティブ対応 (factor=1)
 * - 15m: 5m × 3 を集約
 * - 30m: 5m × 6 を集約
 * - 4h:  1h × 4 を集約
 * - 1d:  eod period=d
 * - 1w:  eod period=w
 */
export function planEodhdFetch(timeframe: Timeframe): EodhdFetchPlan {
  switch (timeframe) {
    case '1m':
      return { kind: 'intraday', interval: '1m', factor: 1 };
    case '5m':
      return { kind: 'intraday', interval: '5m', factor: 1 };
    case '15m':
      return { kind: 'intraday', interval: '5m', factor: 3 };
    case '30m':
      return { kind: 'intraday', interval: '5m', factor: 6 };
    case '1h':
      return { kind: 'intraday', interval: '1h', factor: 1 };
    case '4h':
      return { kind: 'intraday', interval: '1h', factor: 4 };
    case '1d':
      return { kind: 'eod', period: 'd' };
    case '1w':
      return { kind: 'eod', period: 'w' };
  }
}

/**
 * timestamp (ms) を `bucketIntervalMs` の倍数に floor する。
 *
 * UTC 0 を起点とするため、15m なら :00/:15/:30/:45、4h なら 00/04/08/12/16/20 UTC に揃う。
 * `1w` の場合は週次境界が UTC Thursday になる点に注意 (Unix epoch 起点)。
 */
export function bucketStartMs(timestampMs: number, bucketIntervalMs: number): number {
  return Math.floor(timestampMs / bucketIntervalMs) * bucketIntervalMs;
}

/**
 * source OHLCV を `targetBucketMs` のバケットに集約する。
 *
 * 集約ルール (時系列順に並んだ source 前提):
 * - timestamp: バケット開始時刻 (UTC アライン)
 * - open:  バケット内の最初の bar の open
 * - high:  バケット内の全 bar の high の最大
 * - low:   バケット内の全 bar の low の最小
 * - close: バケット内の最後の bar の close
 * - volume: バケット内の全 bar の volume の合計
 *
 * source は時系列昇順 (古い→新しい) を前提とする。順不同で渡された場合は内部で sort し直す。
 * 同じバケットに 1 本も bar が無い場合、そのバケットは結果に含まれない (= 欠損許容)。
 */
export function aggregateOHLCV(source: OHLCVBar[], targetBucketMs: number): OHLCVBar[] {
  if (source.length === 0) return [];

  const sorted = [...source].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  const buckets = new Map<number, OHLCVBar>();
  for (const bar of sorted) {
    const key = bucketStartMs(bar.timestamp.getTime(), targetBucketMs);
    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, {
        symbol: bar.symbol,
        timestamp: new Date(key),
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
      });
    } else {
      existing.high = Math.max(existing.high, bar.high);
      existing.low = Math.min(existing.low, bar.low);
      existing.close = bar.close;
      existing.volume += bar.volume;
    }
  }

  return Array.from(buckets.values()).sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
  );
}
