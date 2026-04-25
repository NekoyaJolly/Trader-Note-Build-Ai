/**
 * 日付範囲をAPI制限に合わせて分割する共通ユーティリティ。
 */

export interface DateChunk {
  start: Date;
  end: Date;
}

export function splitDateRange(startDate: Date, endDate: Date, maxTimespanMs: number): DateChunk[] {
  if (!(maxTimespanMs > 0)) {
    throw new Error('maxTimespanMs は正の数である必要があります');
  }
  const startMs = startDate.getTime();
  const endMs = endDate.getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    throw new Error('startDate/endDate が不正です');
  }
  if (endMs <= startMs) return [];

  const chunks: DateChunk[] = [];
  let current = startMs;
  while (current < endMs) {
    const chunkEnd = Math.min(current + maxTimespanMs, endMs);
    chunks.push({
      start: new Date(current),
      end: new Date(chunkEnd),
    });
    current = chunkEnd;
  }
  return chunks;
}
